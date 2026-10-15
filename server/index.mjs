import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { AppError, assert, checkQuality, uid, now, parseResult, validateResult } from './domain.mjs';
import { getProvider } from './providers.mjs';
import { getReviewQueue, recordReview } from './reviews.mjs';
import { createBatch, previewBatch, commitBatch, batchFile } from './batches.mjs';
import { generateBatchWithAPI } from './batch-api.mjs';
import { AIConfig } from './ai-config.mjs';
import { IIIAPIProvider, generateJob, startGenerateJob, auditCorpus, recoverProcessingJobs } from './iiiapi.mjs';
import { draftIdea } from './ideas.mjs';
import { MobileBridge } from './mobile.mjs';
import { getPracticeNext } from './practice.mjs';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.woff2':'font/woff2'};
export function createApp(store,{staticDir=resolve('dist'),aiProvider=new IIIAPIProvider({config:new AIConfig({file:resolve(dirname(store.file),'api-secrets.json')})}),requestGuard,mobileBridge,recoverJobs=true}={}) {
  if(recoverJobs) recoverProcessingJobs(store);
  const reply=(res,status,data,headers={})=> {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Yasy-Dataset':store.datasetEpoch(),...headers});res.end(JSON.stringify(data));};
  return async (req,res)=> {
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if(requestGuard) requestGuard(req,url);
      else assert(/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? ''),'仅允许本机访问。',403);
      if(req.method==='OPTIONS') throw new AppError('不支持跨站访问。',403);
      if(!['GET','HEAD'].includes(req.method)) {
        const origin=req.headers.origin;
        if(!requestGuard) assert(!origin || /^http:\/\/(localhost|127\.0\.0\.1):(?:4318|5178)$/.test(origin),'拒绝其他网站发起的修改请求。',403);
        assert((req.headers['content-type'] ?? '').startsWith('application/json'),'请使用 application/json 请求。',415);
        assert(!req.headers['x-yasy-dataset'] || req.headers['x-yasy-dataset']===store.datasetEpoch(),'学习数据已被覆盖更新，请刷新后继续；旧页面内容未写入。',409);
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
        const limit=(parts[1]==='backup' ? 51 : 20)*1024*1024;
        for await(const chunk of req) {size+=chunk.length;assert(size<=limit,parts[1]==='backup' ? '备份请求过大（学习快照上限 50 MB）。' : '请求过大（上限 20 MB）。',413);chunks.push(chunk);}
        assert(!req.headers['x-yasy-dataset'] || req.headers['x-yasy-dataset']===store.datasetEpoch(),'学习数据已被覆盖更新，请刷新后继续；旧页面内容未写入。',409);
        try {const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(parsed && typeof parsed==='object' && !Array.isArray(parsed),'请求必须是对象。');return parsed;} catch(e) {if(e instanceof AppError) throw e;throw new AppError('请求 JSON 格式错误。');}
      };
      let data;
      if(parts[1]==='mobile') {
        assert(req.yasyClient!=='ios','手机不能管理 Mac 的配对入口。',403);
        if(req.method==='GET' && parts[2]==='status') data=mobileBridge ? mobileBridge.status() : {available:false,running:false,port:4319,urls:[],fingerprint:null,pairing:null,devices:[]};
        else {
          assert(mobileBridge,'当前服务未启用手机接入管理。',503);
          if(req.method==='POST' && parts[2]==='start') {await body();data=await mobileBridge.start();}
          else if(req.method==='POST' && parts[2]==='stop') {await body();data=await mobileBridge.stop();}
          else if(req.method==='POST' && parts[2]==='pairing-code') {await body();data=mobileBridge.refreshCode();}
          else if(req.method==='DELETE' && parts[2]==='devices' && parts[3]) data=mobileBridge.revoke(parts[3]);
          else throw new AppError('手机管理接口不存在。',404);
        }
      }
      else if(req.method==='GET' && parts[1]==='health') data={ok:true,version:'0.1.0',localOnly:req.yasyClient!=='ios'};
      else if(req.method==='GET' && parts[1]==='ai' && parts[2]==='config') data=aiProvider.config.public(req.yasyClient==='ios' ? 'iiiapi' : store.settings().provider);
      else if(req.method==='PATCH' && parts[1]==='ai' && parts[2]==='config') {
        const input=await body();assert(input.provider===undefined || ['web-bridge','iiiapi'].includes(input.provider),'未知 AI 处理方式。');
        assert(req.yasyClient!=='ios' || input.provider===undefined || input.provider==='iiiapi','手机端只支持 API 处理。',409);
        aiProvider.config.update(input);
        if(input.provider!==undefined && req.yasyClient!=='ios') store.setSettings({provider:input.provider});
        data=aiProvider.config.public(req.yasyClient==='ios' ? 'iiiapi' : store.settings().provider);
      }
      else if(req.method==='GET' && parts[1]==='ai' && parts[2]==='models') data=await aiProvider.models();
      else if(req.method==='POST' && parts[1]==='ai' && parts[2]==='test') {const models=await aiProvider.models();data={ok:true,model:models.selectedModel,message:`已获取 ${models.models.length} 个模型。本次仅查询列表，未发起内容生成。`};}
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='manifest') data={schemaVersion:1,readOnly:true,deviceRole:'full-reader',scopes:['speaking','writing-task1','writing-task2'],endpoints:{snapshot:'/api/v1/snapshot',content:'/api/v1/content/{questionId}'},connectivity:mobileBridge?.running ? 'authenticated-lan-https' : 'loopback-only',pairing:mobileBridge ? 'local-code-certificate-pin' : 'reserved'};
      else if(req.method==='GET' && parts[1]==='v2' && parts[2]==='manifest') data={schemaVersion:2,readOnly:false,deviceRole:'full-client',apiBase:'/api',platformPolicy:{macProviders:['iiiapi','web-bridge'],iosProviders:['iiiapi']},endpoints:{snapshot:'/api/v1/snapshot',content:'/api/v1/content/{questionId}',practice:'/api/practice/next',draft:'/api/drafts/{questionId}',ideas:'/api/ideas',createJob:'/api/jobs',generate:'/api/jobs/{jobId}/generate',materialHistory:'/api/materials/{materialId}/history',corpusAudit:'/api/corpus/audit',reviews:'/api/reviews',words:'/api/words',batches:'/api/batches',batchGenerate:'/api/batches/{batchId}/generate',batchCommit:'/api/batches/{batchId}/commit',settings:'/api/settings',backup:'/api/backup'},connectivity:mobileBridge?.running ? 'authenticated-lan-https' : 'loopback-only',pairing:mobileBridge ? 'local-code-certificate-pin' : 'reserved'};
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='snapshot') data={schemaVersion:1,generatedAt:now(),state:store.state(),answerRevisions:store.all('revisions'),reviews:store.all('review_states'),reviewEvents:store.all('review_events'),batches:store.all('batch_jobs')};
      else if(req.method==='GET' && parts[1]==='v1' && parts[2]==='content' && parts[3]) {
        const question=store.question(parts[3]);const answer=store.all('answers').find(a=>a.questionId===question.id);
        data={schemaVersion:1,question,answer:answer ?? null,draft:store.get('drafts',question.id) ?? null,materials:store.all('materials').filter(m=>answer?.materialIds.includes(m.id)),expressions:store.all('expressions').filter(e=>answer?.expressionIds.includes(e.id)),recommendations:store.recommendations(question.id)};
      }
      else if(req.method==='GET' && parts[1]==='state') data=store.state();
      else if(req.method==='GET' && parts[1]==='practice' && parts[2]==='next' && parts.length===3) data=getPracticeNext(store,{kind:url.searchParams.get('kind'),mode:url.searchParams.get('mode') ?? 'first',currentId:url.searchParams.get('currentId') ?? undefined});
      else if(req.method==='GET' && parts[1]==='materials' && parts[3]==='history') data=store.materialHistory(parts[2]);
      else if(req.method==='POST' && parts[1]==='corpus' && parts[2]==='audit') data=await auditCorpus(store,aiProvider,await body());
      else if(req.method==='POST' && parts[1]==='ideas') data=await draftIdea(store,aiProvider,await body());
      else if(req.method==='GET' && parts[1]==='reviews' && parts[2]==='next') data=getReviewQueue(store,url.searchParams.get('kind') ?? 'speaking');
      else if(req.method==='POST' && parts[1]==='reviews' && !parts[2]) {const input=await body();data=recordReview(store,input.kind,input.id);}
      else if(req.method==='GET' && parts[1]==='batches' && !parts[2]) data={jobs:store.all('batch_jobs')};
      else if(req.method==='POST' && parts[1]==='batches' && !parts[2]) data=await createBatch(store,await body());
      else if(req.method==='POST' && parts[1]==='batches' && parts[3]==='generate') {await body();data=await generateBatchWithAPI(store,aiProvider,parts[2]);}
      else if(req.method==='POST' && parts[1]==='batches' && parts[3]==='preview') data=previewBatch(store,parts[2],await body());
      else if(req.method==='POST' && parts[1]==='batches' && parts[3]==='commit') data=commitBatch(store,parts[2],(await body()).selectedKeys);
      else if(req.method==='GET' && parts[1]==='batches' && parts[3]==='file') {
        const {job,file}=await batchFile(store,parts[2]);
        const filename=encodeURIComponent(job.filename).replace(/'/g,'%27');
        res.writeHead(200,{'Content-Type':job.extension==='pdf' ? 'application/pdf' : job.extension==='docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword','Content-Disposition':`attachment; filename="yasy-${job.id}.${job.extension}"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file);return;
      }
      else if(req.method==='GET' && parts[1]==='sources' && parts[3]==='file') {
        const source=store.get('sources',parts[2]);assert(source && /^[A-Za-z0-9_-]+$/.test(source.id),'资料来源不存在。',404);
        let file;try{file=await readFile(resolve(dirname(store.file),'source-pdfs',`${source.id}.pdf`));}catch{throw new AppError('当前 Mac 未保存此来源 PDF。题库和译文仍可正常查看。',404);}
        const filename=encodeURIComponent(source.title).replace(/'/g,'%27');res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="source.pdf"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file);return;
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
        assert(input.client===undefined || input.client==='ios','未知客户端类型。');
        const client=req.yasyClient==='ios' ? 'ios' : input.client;
        const provider=client==='ios' ? 'iiiapi' : store.settings().provider;
        const {prompt}=getProvider(provider).prepare({question:q,draftZh:draft.textZh,selectedMaterials,candidates,targetBand:store.settings().targetBand,requestId:id});
        const job={id,questionId:q.id,scope:q.scope,textZh:draft.textZh,materialIds:draft.materialIds,materialVersions:Object.fromEntries(selectedMaterials.map(m=>[m.id,m.version ?? 1])),selectedMaterialSnapshots:selectedMaterials.map(m=>({...m,version:m.version ?? 1})),targetBand:store.settings().targetBand,contractVersion:2,provider,...(client ? {client} : {}),prompt,status:'pending',createdAt:now(),candidateIds:candidates.map(c=>c.id)};
        store.saveJob(job);data={job,prompt,quality};
      }
      else if(req.method==='POST' && parts[1]==='jobs' && parts[3]==='generate') {
        assert(req.yasyClient==='ios' || store.settings().provider==='iiiapi' || store.get('jobs',parts[2])?.client==='ios','请先切换到 iiiapi API 处理方式。',409);
        const input=await body();
        if(input.background===true) {data=await startGenerateJob(store,aiProvider,parts[2]);reply(res,202,data);return;}
        data=await generateJob(store,aiProvider,parts[2]);
      }
      else if(req.method==='POST' && parts[1]==='jobs' && parts[3]==='result') {
        const input=await body();
        const job=store.assertPendingJob(parts[2]);
        assert(job.client!=='ios' && req.yasyClient!=='ios','手机端只使用 API 整理通道。',409);
        const parsed=parseResult(input.result);
        const q=store.question(job.questionId);
        const candidates=(job.candidateIds ?? []).map(id=>store.question(id));
        const validated=validateResult(parsed,job,q,candidates);
        if(!validated.passed) {const quality={passed:false,score:0,suggestions:validated.suggestions,checks:[],note:'AI 素材质量反馈，请修改中文素材后重新生成提示词。'};store.insert('jobs',{...job,status:'needs-revision',finishedAt:now(),quality});throw new AppError('AI 认为素材仍需补充；答案尚未保存。',422,{quality});}
        store.importResult(job,validated);data={state:store.state()};
      }
      else if(req.method==='POST' && parts[1]==='words' && !parts[2]) data=store.addWord(await body());
      else if(req.method==='DELETE' && parts[1]==='words' && parts[2]) {store.deleteWord(parts[2]);data={ok:true};}
      else if(req.method==='PATCH' && parts[1]==='settings') {
        const input=await body();const allowed=['targetBand','dailySpeaking','dailyWriting','examType','provider'];assert(Object.keys(input).every(k=>allowed.includes(k)),'存在未知设置。');assert(req.yasyClient!=='ios' || input.provider===undefined || input.provider==='iiiapi','手机端只支持 API 处理。',409);if(req.yasyClient==='ios') delete input.provider;data=store.setSettings(input);
      }
      else if(req.method==='PUT' && parts[1]==='plan') data=store.setPlan((await body()).questionIds);
      else if(req.method==='GET' && parts[1]==='backup') {
        const backup=parts[2]==='previous' ? store.previousBackup() : store.backup();
        assert(backup,'尚无恢复前的备份。',404);
        reply(res,200,backup,{'Content-Disposition':`attachment; filename="yasy-${parts[2]==='previous' ? 'before-restore' : 'backup'}-${new Date().toISOString().slice(0,10)}.json"`});return;
      }
      else if(req.method==='POST' && parts[1]==='backup') {
        const input=await body();
        if(req.yasyClient==='ios') assert(!store.all('jobs').some(j=>j.status==='processing') && !store.all('batch_jobs').some(j=>j.status==='processing'),'Mac 仍有 AI 任务在处理，请等待完成后同步。',409);
        store.restore(input.backup);data={state:store.state()};
      }
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
  const mobile=new MobileBridge({dataDir:dirname(store.file),appFactory:requestGuard=>createApp(store,{requestGuard,mobileBridge:mobile,recoverJobs:false})});
  const server=createServer(createApp(store,{mobileBridge:mobile}));
  const port=Number(process.env.PORT || 4318);
  server.listen(port,'127.0.0.1',()=>console.log(`Yasy ready: http://127.0.0.1:${port}\nLocal data: ${store.file}`));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE' ? `端口 ${port} 已被占用。若 Yasy 已在运行，请直接打开 http://127.0.0.1:${port}。` : e.message);store.close();process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await mobile.stop();server.close(()=>{store.close();process.exit(0);});});
}
