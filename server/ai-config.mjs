import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assert, text } from './domain.mjs';

export const IIIAPI_BASE_URL='https://api.iiiapi.com/v1';
export class AIConfig {
  constructor({file=resolve(process.env.YASY_DATA_DIR || '.local','api-secrets.json')}={}) {this.file=file;}
  secret() {
    if(!existsSync(this.file)) return {apiKey:'',model:''};
    try {const data=JSON.parse(readFileSync(this.file,'utf8'));return {apiKey:typeof data.apiKey==='string' ? data.apiKey : '',model:typeof data.model==='string' ? data.model : ''};}
    catch {throw new Error('本机 API 配置文件无法读取。请重新保存 API 设置。');}
  }
  update(input) {
    assert(input && typeof input==='object' && Object.keys(input).every(k=>['apiKey','model','provider'].includes(k)),'API 配置包含未知字段。');
    const next=this.secret();
    if(input.apiKey!==undefined && input.apiKey!=='') {
      const key=text(input.apiKey,'API key',512);
      assert(/^[A-Za-z0-9_.-]{10,512}$/.test(key),'API key 格式无效。');
      next.apiKey=key;
    }
    if(input.model!==undefined) next.model=text(input.model,'模型 ID',200,true);
    mkdirSync(dirname(this.file),{recursive:true});
    const temp=`${this.file}.tmp`;
    writeFileSync(temp,JSON.stringify(next)+'\n',{mode:0o600});chmodSync(temp,0o600);renameSync(temp,this.file);chmodSync(this.file,0o600);
    return next;
  }
  public(provider='web-bridge') {const {apiKey,model}=this.secret();return {provider,baseUrl:IIIAPI_BASE_URL,hasKey:!!apiKey,model,configured:provider==='web-bridge' || !!(apiKey&&model)};}
  redact(message,...credentials) {let safe=String(message ?? '');for(const key of new Set([this.secret().apiKey,...credentials].filter(Boolean))) safe=safe.replaceAll(key,'[redacted]');return safe.replace(/sk-[A-Za-z0-9_.-]{8,}/g,'[redacted]').slice(0,1200);}
}
