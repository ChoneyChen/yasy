import { basename, extname, dirname, resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildBatchPrompt } from './prompts.mjs';
import { uid, now, day, assert, text, tags, scopes, parseResult, stringList, AppError } from './domain.mjs';

const normalized=value=>(value ?? '').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const fingerprint=q=>JSON.stringify([q.scope,normalized(q.promptEn),q.part ?? '',q.taskType ?? '',(q.cuePoints ?? []).map(normalized),q.visual ? {kind:q.visual.kind,title:normalized(q.visual.title),columns:(q.visual.columns ?? []).map(normalized),rows:q.visual.rows ?? [],steps:(q.visual.steps ?? []).map(normalized),note:normalized(q.visual.note)} : null]);
const uploadPath=(store,job)=>resolve(dirname(store.file),'uploads',`${job.id}.${job.extension}`);
export async function createBatch(store,input) {
  const filename=text(input.filename,'文件名',200);
  assert(basename(filename)===filename,'文件名不可包含路径。');
  const extension=extname(filename).slice(1).toLowerCase();
  assert(['pdf','doc','docx'].includes(extension),'支持 PDF、DOC 和 DOCX 题目汇总资料。');
  const scope=input.scope ?? 'mixed';assert(['mixed',...scopes].includes(scope),'请选择导入范围。');
  assert(typeof input.fileBase64==='string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.fileBase64),'上传内容编码错误。');
  const file=Buffer.from(input.fileBase64,'base64');
  assert(file.length>0 && file.length<=10*1024*1024,'原文件大小应在 0–10 MB 之间。');
  const magic=extension==='pdf' ? file.subarray(0,5).toString()==='%PDF-' : extension==='docx' ? file.subarray(0,2).toString()==='PK' : file.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  assert(magic,'文件内容与扩展名不符。请上传有效的 PDF、DOC 或 DOCX。');
  const id=uid('batch');
  const prompt=buildBatchPrompt({requestId:id,filename,scope:scope==='mixed' ? 'all' : scope});
  const job={id,filename,scope,extension,prompt,createdAt:now(),status:'pending',size:file.length,sha256:createHash('sha256').update(file).digest('hex')};
  const path=uploadPath(store,job);await mkdir(dirname(path),{recursive:true});await writeFile(path,file,{mode:0o600});
  store.insert('batch_jobs',job);return {job,prompt};
}
function validateQuestion(o,job) {
  assert(o && typeof o==='object' && !Array.isArray(o),'导入题目必须是对象。');
  assert(scopes.includes(o.scope) && (job.scope==='mixed' || job.scope===o.scope),'题目不属于本次选择的导入范围。');
  const part=text(o.part,'口语 Part',30,true);
  assert(o.scope==='speaking' ? ['Part 1','Part 2','Part 3'].includes(part) : part==='','口语需注明 Part 1/2/3，写作的 part 应为空。');
  assert(['reported','adapted'].includes(o.sourceType),'导入题目应标为资料转录 / 改编，不能未经核验标为官方。');
  let visual=null;
  if(o.visual!==null && o.visual!==undefined) {
    const v=o.visual;assert(v && typeof v==='object' && ['table','bar','line','pie','process','map'].includes(v.kind),'图表类型错误。');
    assert(o.scope==='writing-task1','图表信息仅用于小作文。');
    const columns=stringList(v.columns ?? [],'图表列',30),steps=stringList(v.steps ?? [],'图表步骤',50);
    assert(Array.isArray(v.rows) && v.rows.length<=100 && v.rows.every(row=>Array.isArray(row) && row.length<=30 && row.every(cell=>typeof cell==='string' || (typeof cell==='number' && Number.isFinite(cell)))),'图表数据格式错误。');
    assert(!v.rows.length || (columns.length>0 && v.rows.every(row=>row.length===columns.length)),'图表列名与每行数据的数量必须一致。');
    visual={kind:v.kind,title:text(v.title,'图表标题',500),columns,rows:v.rows,steps,note:text(v.note ?? '','图表说明',3000,true)};
  }
  return {scope:o.scope,topicZh:text(o.topicZh,'中文主题',200),topicEn:text(o.topicEn,'英文主题',200),titleZh:text(o.titleZh,'题目标题',300),promptEn:text(o.promptEn,'英文题干',10000),promptZh:text(o.promptZh,'中文题干',10000),part,taskType:text(o.taskType,'题型',200,o.scope==='speaking'),cuePoints:stringList(o.cuePoints,'题卡要点',20),tags:tags(o.tags),sourceNote:text(o.sourceNote,'原文件页码 / 来源说明',3000),sourceType:o.sourceType,visual};
}
export function previewBatch(store,id,input) {
  const job=store.get('batch_jobs',id);assert(job,'批量任务不存在。',404);assert(job.status!=='completed','本批已经确认入库；可创建新批次。',409);
  const result=parseResult(input.result);assert(result.requestId===job.id,'这份题目列表不属于当前上传任务。',409);
  assert(Array.isArray(result.questions) && result.questions.length>0 && result.questions.length<=500,'每批需包含 1–500 道题。');
  const known=new Set(store.all('questions').map(fingerprint));
  const candidates=result.questions.map((o,i)=>{
    const q=validateQuestion(o,job);const key=`${id}:${i}`;const f=fingerprint(q);const duplicate=known.has(f);known.add(f);return {...q,key,duplicate};
  });
  const next={...job,status:'previewed',candidates};store.insert('batch_jobs',next);
  return {job:next,candidates};
}
export function commitBatch(store,id,keys) {
  assert(Array.isArray(keys) && keys.length>0 && keys.length<=500 && keys.every(k=>typeof k==='string'),'请选择希望正式入库的题目。');
  return store.transaction(()=> {
    const job=store.get('batch_jobs',id);assert(job && job.status==='previewed','请先预览并核对本批题目。',409);
    assert(new Set(keys).size===keys.length && keys.every(k=>job.candidates.some(c=>c.key===k)),'所选题目不属于本批次。');
    const sourceId=uid('source');
    const source={id:sourceId,title:`用户上传：${job.filename}`,url:`/api/batches/${job.id}/file`,type:'user-upload',accessedAt:day(),note:'由用户上传的资料经 AI 转录。真实性、题季与图表完整性未经官方核验。确认入库仅表示用户选用。'};
    store.insert('sources',source);
    const known=new Set(store.all('questions').map(fingerprint));let imported=0,skipped=0;
    for(const candidate of job.candidates.filter(c=>keys.includes(c.key))) {
      const c=validateQuestion(candidate,job);
      const f=fingerprint(c);if(known.has(f)) {skipped++;continue;}
      let topic=store.all('topics').find(t=>t.scope===c.scope && (t.titleZh===c.topicZh || t.titleEn.toLowerCase()===c.topicEn.toLowerCase()));
      if(!topic) {topic={id:uid('topic'),scope:c.scope,titleZh:c.topicZh,titleEn:c.topicEn,description:'从用户上传资料整理的主题',tags:c.tags};store.insert('topics',topic);}
      const {topicZh,topicEn,sourceNote,visual,...fields}=c;
      store.insert('questions',{...fields,id:uid('question'),topicId:topic.id,sourceId,basis:`用户资料转录；${sourceNote}`,...(visual ? {visual} : {})});
      known.add(f);imported++;
    }
    store.insert('batch_jobs',{...job,status:'completed',imported,skipped,selectedKeys:keys,completedAt:now()});
    return {state:store.state(),imported,skipped};
  });
}
export async function batchFile(store,id) {
  const job=store.get('batch_jobs',id);assert(job,'原文件不存在。',404);
  try {return {job,file:await readFile(uploadPath(store,job))};} catch {throw new AppError('当前 Mac 上没有此原文件。JSON 备份保留题目，但原文件需另行复制 uploads 文件夹。',404);}
}
