import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { AppError, assert, checkQuality, uid, now, parseResult, validateResult } from './domain.mjs';
import { getProvider } from './providers.mjs';
import { getReviewQueue, recordReview } from './reviews.mjs';
import { createBatch, previewBatch, commitBatch, batchFile } from './batches.mjs';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.woff2':'font/woff2'};
export function createApp(store,{staticDir=resolve('dist')}={}) {
  const reply=(res,status,data,headers={})=> {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  return async (req,res)=> {
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      assert(/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? ''),'仅允许本机访问。',403);
      if(req.method==='OPTIONS') throw new AppError('不支持跨站访问。',403);
      if(!['GET','HEAD'].includes(req.method)) {
        const origin=req.headers.origin;
        assert(!origin || /^http:\/\/(localhost|127\.0\.0\.1):(?:4318|5178)$/.test(origin),'拒绝其他网站发起的修改请求。',403);
        assert((req.headers['content-type'] ?? '').startsWith('application/json'),'请使用 application/json 请求。',415);
      }
      if(parts[0]!=='api') {
        assert(req.method==='GET' || req.method==='HEAD','方法不支持。',405);
        let file=resolve(staticDir,`.${decodeURIComponent(url.pathname)}`);
        assert(file===staticDir || file.startsWith(staticDir+sep),'路径无效。',403);
        try {if((await stat(file)).isDirectory()) file=resolve(file,'index.html');} catch {file=resolve(staticDir,'index.html');}
        let content;
        try {content=await readFile(file);} catch {throw new AppError('前端尚未构建。请运行 npm run build 后再启动，或使用 npm run dev。',503);}
        res.writeHead(200,{'Content-Type':mime[extname(file)] ?? 'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",'Cache-Control':extname(file)==='.html' ? 'no-cache' : 'public, max-age=3600'});
        res.end(req.method==='HEAD' ? undefined : content);return;
      }
      const body=async()=> {
        let size=0;const chunks=[];
        for await(const chunk of req) {size+=chunk.length;assert(size<=20*1024*1024,'请求过大（上限 20 MB）。',413);chunks.push(chunk);}
        try {const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(parsed && typeof parsed==='object' && !Array.isArray(parsed),'请求必须是对象。');return parsed;} catch(e) {if(e instanceof AppError) throw e;throw new AppError('请求 JSON 格式错误。');}
      };
      let data;
      if(req.method==='GET' && parts[1]==='health') data={ok:true,version:'0.1.0',localOnly:true};
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='manifest') data={schemaVersion:1,readOnly:true,deviceRole:'full-reader',scopes:['speaking','writing-task1','writing-task2'],endpoints:{snapshot:'/api/v1/snapshot',content:'/api/v1/content/{questionId}'},connectivity:'loopback-only',pairing:'reserved'};
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='snapshot') data={schemaVersion:1,generatedAt:now(),state:store.state(),answerRevisions:store.all('revisions'),reviews:store.all('review_states'),reviewEvents:store.all('review_events'),batches:store.all('batch_jobs')};
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='content' && parts[3]) {
        const question=store.question(parts[3]);const answer=store.all('answers').find(a=>a.questionId===question.id);
        data={schemaVersion:1,question,answer:answer ?? null,draft:store.get('drafts',question.id) ?? null,materials:store.all('materials').filter(m=>answer?.materialIds.includes(m.id)),expressions:store.all('expressions').filter(e=>answer?.expressionIds.includes(e.id)),recommendations:store.recommendations(question.id)};
      }
      else if(req.method==='GET' && parts[1]==='state') data=store.state();
      else if(req.method==='GET' && parts[1]==='reviews' && parts[2]==='next') data=getReviewQueue(store,url.searchParams.get('kind') ?? 'speaking');
      else if(req.method==='POST' && parts[1]==='reviews' && !parts[2]) {const input=await body();data=recordReview(store,input.kind,input.id);}
      else if(req.method==='GET' && parts[1]==='batches' && !parts[2]) data={jobs:store.all('batch_jobs')};
      else if(req.method==='POST' && parts[1]==='batches' && !parts[2]) data=await createBatch(store,await body());
      else if(req.method==='POST' && parts[1]==='batches' && parts[3]==='preview') data=previewBatch(store,parts[2],await body());
      else if(req.method==='POST' && parts[1]==='batches' && parts[3]==='commit') data=commitBatch(store,parts[2],(await body()).selectedKeys);
      else if(req.method==='GET' && parts[1]==='batches' && parts[3]==='file') {
        const {job,file}=await batchFile(store,parts[2]);
        const filename=encodeURIComponent(job.filename).replace(/'/g,'%27');
        res.writeHead(200,{'Content-Type':job.extension==='pdf' ? 'application/pdf' : job.extension==='docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword','Content-Disposition':`attachment; filename="yasy-${job.id}.${job.extension}"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file);return;
      }
      else if(req.method==='GET' && parts[1]==='questions' && parts[3]==='recommendations') data=store.recommendations(parts[2]);
      else if(req.method==='PUT' && parts[1]==='drafts' && parts[2]) data=store.saveDraft(parts[2],await body());
      else if(req.method==='POST' && parts[1]==='quality') {const input=await body();data=checkQuality(store.question(input.questionId),input.textZh);}
      else if(req.method==='POST' && parts[1]==='jobs' && !parts[2]) {
        const input=await body();const q=store.question(input.questionId);const draft=store.saveDraft(q.id,input);
        const quality=checkQuality(q,draft.textZh);
        if(!quality.passed) throw new AppError('中文素材还需补充。',422,{quality});
        const selectedMaterials=store.validateMaterials(q,draft.materialIds);
        const candidates=store.candidates(q);
        const id=uid('job');
        const {prompt}=getProvider(store.settings().provider).prepare({question:q,draftZh:draft.textZh,selectedMaterials,candidates,targetBand:store.settings().targetBand,requestId:id});
        const job={id,questionId:q.id,scope:q.scope,textZh:draft.textZh,materialIds:draft.materialIds,prompt,status:'pending',createdAt:now(),candidateIds:candidates.map(c=>c.id)};
        store.saveJob(job);data={job,prompt,quality};
      }
      else if(req.method==='POST' && parts[1]==='jobs' && parts[3]==='result') {
        const input=await body();
        const job=store.assertPendingJob(parts[2]);
        const parsed=parseResult(input.result);
        const q=store.question(job.questionId);
        const candidates=(job.candidateIds ?? []).map(id=>store.question(id));
        const validated=validateResult(parsed,job,q,candidates);
        if(!validated.passed) {store.insert('jobs',{...job,status:'needs-revision'});throw new AppError('AI 认为素材仍需补充；答案尚未保存。',422,{quality:{passed:false,score:0,suggestions:validated.suggestions,checks:[],note:'AI 素材质量反馈，请修改中文素材后重新生成提示词。'}});}
        store.importResult(job,validated);data={state:store.state()};
      }
      else if(req.method==='POST' && parts[1]==='words' && !parts[2]) data=store.addWord(await body());
      else if(req.method==='DELETE' && parts[1]==='words' && parts[2]) {store.deleteWord(parts[2]);data={ok:true};}
      else if(req.method==='PATCH' && parts[1]==='settings') {
        const input=await body();const allowed=['targetBand','dailySpeaking','dailyWriting','examType','provider'];assert(Object.keys(input).every(k=>allowed.includes(k)),'存在未知设置。');data=store.setSettings(input);
      }
      else if(req.method==='PUT' && parts[1]==='plan') data=store.setPlan((await body()).questionIds);
      else if(req.method==='GET' && parts[1]==='backup') {
        const backup=parts[2]==='previous' ? store.previousBackup() : store.backup();
        assert(backup,'尚无恢复前的备份。',404);
        reply(res,200,backup,{'Content-Disposition':`attachment; filename="yasy-${parts[2]==='previous' ? 'before-restore' : 'backup'}-${new Date().toISOString().slice(0,10)}.json"`});return;
      }
      else if(req.method==='POST' && parts[1]==='backup') {store.restore((await body()).backup);data={state:store.state()};}
      else throw new AppError('接口不存在。',404);
      reply(res,200,data);
    } catch(e) {
      if(e instanceof AppError) reply(res,e.status,{error:e.message,...e.extra});
      else {console.error('Yasy request failed:',e.message);reply(res,500,{error:'保存失败，现有数据已保留。请查看本机终端日志。'});}
    }
  };
}

if(import.meta.url===pathToFileURL(process.argv[1] ?? '').href) {
  const store=new Store();
  const server=createServer(createApp(store));
  const port=Number(process.env.PORT || 4318);
  server.listen(port,'127.0.0.1',()=>console.log(`Yasy ready: http://127.0.0.1:${port}\nLocal data: ${store.file}`));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE' ? `端口 ${port} 已被占用。若 Yasy 已在运行，请直接打开 http://127.0.0.1:${port}。` : e.message);store.close();process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
