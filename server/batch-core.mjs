import { uid, now, day, assert, text, tags, scopes, parseResult, stringList } from './domain.mjs';
const normalized=value=>(value ?? '').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const fingerprint=q=>JSON.stringify([q.scope,normalized(q.promptEn),q.part ?? '',q.taskType ?? '',(q.cuePoints ?? []).map(normalized),q.visual ? {kind:q.visual.kind,title:normalized(q.visual.title),columns:(q.visual.columns ?? []).map(normalized),rows:q.visual.rows ?? [],steps:(q.visual.steps ?? []).map(normalized),note:normalized(q.visual.note)} : null]);
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
  if(o.sourcePage!==undefined) assert(Number.isInteger(o.sourcePage) && o.sourcePage>0 && o.sourcePage<=20000,'来源页码无效。');
  if(o.sourcePages!==undefined) assert(Array.isArray(o.sourcePages) && o.sourcePages.length<=400 && o.sourcePages.every(p=>Number.isInteger(p) && p>0 && p<=20000),'来源跨页范围无效。');
  return {scope:o.scope,topicZh:text(o.topicZh,'中文主题',200),topicEn:text(o.topicEn,'英文主题',200),titleZh:text(o.titleZh,'题目标题',300),promptEn:text(o.promptEn,'英文题干',10000),promptZh:text(o.promptZh,'中文题干',10000),part,taskType:text(o.taskType,'题型',200,o.scope==='speaking'),cuePoints:stringList(o.cuePoints,'题卡要点',20),tags:tags(o.tags),sourceNote:text(o.sourceNote,'原文件页码 / 来源说明',3000),sourceType:o.sourceType,visual,...(o.sourcePage!==undefined ? {sourcePage:o.sourcePage} : {}),...(o.sourcePages!==undefined ? {sourcePages:[...new Set(o.sourcePages)]} : {})};
}
export function previewBatch(store,id,input) {
  const job=store.get('batch_jobs',id);assert(job,'批量任务不存在。',404);assert(job.status!=='completed','本批已经确认入库；可创建新批次。',409);
  const result=parseResult(input.result);assert(result.requestId===job.id,'这份题目列表不属于当前上传任务。',409);
  assert(Array.isArray(result.questions) && result.questions.length>0 && result.questions.length<=1000,'每批需包含 1–1000 道题。');
  const known=new Set(store.all('questions').map(fingerprint));
  const candidates=result.questions.map((o,i)=>{
    const q=validateQuestion(o,job);const key=`${id}:${i}`;const f=fingerprint(q);const duplicate=known.has(f);known.add(f);return {...q,key,duplicate};
  });
  const next={...job,status:'previewed',candidates};store.insert('batch_jobs',next);
  return {job:next,candidates};
}
export function commitBatch(store,id,keys) {
  assert(Array.isArray(keys) && keys.length>0 && keys.length<=1000 && keys.every(k=>typeof k==='string'),'请选择希望正式入库的题目。');
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
