import { buildPrompt } from './prompts.mjs';
import { AIConfig, IIIAPI_BASE_URL } from './ai-config.mjs';
import { AppError, assert, parseAPIContent, validateResult, uid, now } from './domain.mjs';
import { assessExpression } from './corpus.mjs';

export class IIIAPIProvider {
  id='iiiapi';automated=true;
  constructor({config=new AIConfig(),baseUrl=IIIAPI_BASE_URL,fetchImpl=fetch,timeoutMs=180000,modelTimeoutMs=20000}={}) {
    // Production always uses the documented HTTPS host. Dependency injection is
    // only available to local code/tests, never through a client request.
    this.config=config;this.baseUrl=baseUrl;this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.modelTimeoutMs=modelTimeoutMs;
  }
  prepare(input) {return {prompt:buildPrompt(input),requiresUserSubmission:false};}
  async request(path,{body,timeoutMs=this.timeoutMs,credential=this.config.secret().apiKey}={}) {
    const apiKey=credential;assert(apiKey,'请先在偏好与数据中配置 iiiapi API key。',503);
    try {
      const response=await this.fetch(`${this.baseUrl}${path}`,{method:body ? 'POST' : 'GET',headers:{Authorization:`Bearer ${apiKey}`,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const raw=await response.text();
      assert(raw.length<=5*1024*1024,'API 返回内容过大。',502);
      let result;try{result=JSON.parse(raw);}catch{throw new AppError(`iiiapi 返回了非 JSON 响应（HTTP ${response.status}）。`,502);}
      if(!response.ok) {
        const detail=this.config.redact(result?.error?.message ?? result?.message ?? `HTTP ${response.status}`,apiKey);
        const prefix=response.status===401 || response.status===403 ? 'API key 或模型权限不可用' : response.status===429 ? 'API 限流或额度不足' : 'iiiapi 请求失败';
        throw new AppError(`${prefix}：${detail}`,response.status===429 ? 429 : 502);
      }
      return result;
    } catch(e) {
      if(e instanceof AppError) throw e;
      if(['TimeoutError','AbortError'].includes(e.name)) throw new AppError('API 请求超时，未保存任何答案。可稍后重试此任务。',504);
      throw new AppError(`无法连接 iiiapi：${this.config.redact(e.message,apiKey)}`,502);
    }
  }
  async models() {
    const {apiKey}=this.config.secret();
    const result=await this.request('/models',{timeoutMs:this.modelTimeoutMs,credential:apiKey});
    assert(Array.isArray(result.data),'模型列表格式不符合 OpenAI 兼容接口。',502);
    const models=result.data.filter(m=>m && typeof m.id==='string' && m.id.length>0 && m.id.length<=200 && this.config.redact(m.id,apiKey)===m.id).map(m=>({id:m.id,...(typeof m.owned_by==='string' ? {owned_by:this.config.redact(m.owned_by,apiKey)} : {})}));
    return {models:[...new Map(models.map(m=>[m.id,m])).values()].sort((a,b)=>a.id.localeCompare(b.id)),selectedModel:this.config.secret().model};
  }
  async generate(job) {
    const {model,apiKey}=this.config.secret();assert(model,'请获取模型列表并选择一个模型。',503);
    const response=await this.request('/chat/completions',{credential:apiKey,body:{model,messages:[{role:'system',content:'Follow the IELTS task contract exactly. Return one complete JSON object only. Do not invent user experiences or change IDs. Order expressions from most useful to least useful. For each material, only the three best expressions may refer to it via materialIndexes; other expressions remain in the corpus with an empty index list.'},{role:'user',content:job.prompt}],stream:false,max_tokens:8192}});
    const choice=response.choices?.[0];
    assert(choice && choice.message,'API 没有返回可用答案。请选择支持对话的模型。',502);
    assert(choice.finish_reason!=='length','模型输出被截断，答案未保存。请换用能完整输出的模型后重试。',502);
    const result=parseAPIContent(choice.message.content,'答案整理');
    assert(![apiKey,this.config.secret().apiKey].filter(Boolean).some(key=>JSON.stringify(result).includes(key)),'API 返回了不应出现的认证信息，结果未保存。',502);
    const usage=response.usage ? Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(k=>typeof response.usage[k]==='number' && Number.isFinite(response.usage[k])).map(k=>[k,response.usage[k]])) : undefined;
    return {result,model:this.config.redact(typeof response.model==='string' ? response.model : model,apiKey),usage};
  }

}

export { recoverProcessingJobs, startGenerateJob, generateJob, limitExpressionLinks, auditCorpus } from './ai-workflow.mjs';
import { recoverProcessingJobs } from './ai-workflow.mjs';
