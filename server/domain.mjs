import { randomUUID } from 'node:crypto';

export const scopes = ['speaking', 'writing-task1', 'writing-task2'];
export const uid = prefix => `${prefix}_${randomUUID()}`;
export const now = () => new Date().toISOString();
export const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export class AppError extends Error { constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; } }
export function assert(condition, message, status = 400) { if (!condition) throw new AppError(message, status); }
export function text(value, name, max = 20000, allowEmpty = false) {
  assert(typeof value === 'string', `${name}必须是文字。`);
  assert(value.length <= max && (allowEmpty || value.trim().length > 0), `${name}为空或过长（上限 ${max} 字符）。`);
  return value.trim();
}
export function tags(value) { assert(Array.isArray(value) && value.length <= 20, '标签格式错误。'); return [...new Set(value.map(v => text(v, '标签', 80)))]; }
export function stringList(value, name, max = 10) { assert(Array.isArray(value) && value.length <= max, `${name}格式错误。`); return value.map(v => text(v, name, 2000)); }
export function english(value,name,max=20000) {const v=text(value,name,max);assert(!/[\u3400-\u9fff]/.test(v),`${name}应为全英文，中文翻译请放入对应中文字段。`);return v;}
export function wordCount(value) { return (value.match(/[A-Za-z0-9]+(?:['’.,\-][A-Za-z0-9]+)*(?:%|‰)?/g) || []).length; }

// This is a drafting aid, not an IELTS score or an AI content judgement.
export function checkQuality(question, draft) {
  const value = text(draft, '中文素材', 20000, true);
  const length = value.replace(/\s/g, '').length;
  const chinese = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const minimum = question.scope === 'writing-task2' ? 90 : question.scope === 'writing-task1' ? 65 : question.part === 'Part 2' && question.taskType!=='follow-up' ? 80 : question.part === 'Part 3' ? 40 : 20;
  const checks = [{label:`有足够的草稿细节（至少 ${minimum} 字符）`,passed:length >= minimum},{label:'包含可供整理的中文内容',passed:chinese >= Math.min(10, minimum / 2)}];
  const suggestions = [];
  if (!checks[0].passed) suggestions.push(question.scope === 'writing-task1' ? '补充总体趋势、关键比较、数值/单位；流程或地图补充阶段/方位。请依据原图，无法读图时先说明缺少数据。' : question.scope === 'writing-task2' ? '补充明确立场、两个理由、具体例证和反方边界；逐项回应题目要求。' : question.part === 'Part 2' ? '补充人物、时间地点、事件经过，以及你为什么在意它；尽量写出真实细节。' : '写明直接回答、原因，并补一个具体例子或个人感受。');
  if (!checks[1].passed) suggestions.push('请先用中文写你的真实素材/思路，英文答案会在下一步整理。');
  return {passed:checks.every(c=>c.passed),score:Math.round(checks.filter(c=>c.passed).length / checks.length * 100),suggestions,checks,note:'本地初检仅检查草稿长度与中文内容；贴题性、事实充分性由 AI 二次检查。此处数字不是雅思分数。'};
}

function overlap(a, b) { const set = new Set(a.map(x=>x.toLowerCase())); return b.filter(x=>set.has(x.toLowerCase())); }
export function recommendMaterials(question, materials, links) {
  return materials.filter(m=>m.scope===question.scope).map(material=> {
    const explicit = links.find(l=>l.kind==='material-question' && l.fromId===material.id && l.toId===question.id);
    const common = overlap(material.tags,question.tags);
    const score = explicit?.score ?? (common.length ? Math.min(.89, .4 + common.length * .14) : 0);
    return {material,score,reason:explicit?.reason ?? `共同主题：${common.join('、')}（标签匹配，需自行判断贴题性）`};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score || a.material.id.localeCompare(b.material.id)).slice(0,3);
}
export function recommendExpressions(question, expressions, links, materials) {
  const candidates = recommendMaterials(question,materials,links);
  return expressions.filter(e=>e.scope===question.scope).map(expression=>{
    const connected = links.filter(l=>l.kind==='material-expression' && l.toId===expression.id && candidates.some(m=>m.material.id===l.fromId));
    const common = overlap(expression.tags,question.tags);
    const score = Math.max(0,...connected.map(l=>l.score),common.length ? Math.min(.85,.4 + common.length*.12) : 0);
    return {expression,score,reason:connected.length ? '与本题推荐素材关联，可按语境选用' : `共同主题：${common.join('、')}`};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score || a.expression.id.localeCompare(b.expression.id)).slice(0,3);
}

export function parseResult(input) {
  if (typeof input !== 'string') { assert(input && typeof input === 'object' && !Array.isArray(input), '请粘贴完整的 JSON 对象。'); return input; }
  let raw = input.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(raw); } catch { throw new AppError('JSON 解析失败。请复制完整的 JSON（可包含代码围栏），不要夹杂解释文字。'); }
}

export function validateResult(result, job, question, candidates) {
  assert(result && typeof result==='object' && !Array.isArray(result),'结果必须是 JSON 对象。');
  assert(result.requestId===job.id && result.questionId===job.questionId && result.scope===job.scope,'此结果不属于当前任务，请检查 requestId、questionId 与 scope。',409);
  assert(result.quality && typeof result.quality.passed==='boolean','缺少素材质量检查结果。');
  const suggestions = stringList(result.quality.suggestions,'补充建议',20);
  if (!result.quality.passed) return {passed:false,suggestions:suggestions.length ? suggestions : ['请补充与题目有关的具体细节，再生成提示词。']};
  assert(result.answer && typeof result.answer==='object','缺少整理后的答案。');
  const answer = {textEn:english(result.answer.textEn,'英文答案',15000),outlineZh:text(result.answer.outlineZh,'中文结构',5000)};
  const count = wordCount(answer.textEn);
  const min = question.scope==='writing-task1' ? 150 : question.scope==='writing-task2' ? 250 : question.part==='Part 2' && question.taskType!=='follow-up' ? 100 : 10;
  assert(count>=min,`答案只有 ${count} 个英文词，${question.scope==='speaking' ? '该练习' : '雅思写作'}至少需要 ${min} 个词。请让 AI 补全后重新导入。`);
  assert(count<=1200,'答案过长，请按雅思任务整理后导入。');
  assert(Array.isArray(result.materials) && result.materials.length<=8,'素材元格式错误（最多 8 个）。');
  assert(Array.isArray(result.expressions) && result.expressions.length<=20,'语料格式错误（最多 20 条）。');
  assert(Array.isArray(result.recommendations) && result.recommendations.length<=24,'推荐格式错误。');
  assert(question.scope!=='writing-task1' || (!result.materials.length && !result.recommendations.length),'小作文仅积累语料，不创建素材元或素材推送。');
  assert(question.scope==='writing-task1' || result.materials.length>0,'口语和大作文结果需包含至少一个解耦的素材元。');
  const materials = result.materials.map(m=> {
    assert(m && typeof m==='object','素材元格式错误。');
    if (m.existingMaterialId) assert(job.materialIds.includes(m.existingMaterialId),'只可复用本次选择的已有素材。');
    return {title:english(m.title,'素材英文标题',200),summaryZh:text(m.summaryZh,'素材摘要',3000),detailZh:text(m.detailZh,'素材详情',15000),summaryEn:english(m.summaryEn,'素材英文摘要',3000),detailEn:english(m.detailEn,'素材英文详情',15000),tags:tags(m.tags),...(m.existingMaterialId ? {existingMaterialId:m.existingMaterialId} : {})};
  });
  const materialKeys=materials.map(m=>m.existingMaterialId ?? JSON.stringify([m.title,m.summaryZh,m.detailZh,m.summaryEn,m.detailEn,[...m.tags].sort()]));
  assert(new Set(materialKeys).size===materials.length,'结果包含重复素材元。请合并重复事实与相关表达后导入。');
  const expressions = result.expressions.map(e=> {
    assert(e && typeof e==='object','语料格式错误。');
    assert(Array.isArray(e.materialIndexes) && e.materialIndexes.length<=3 && e.materialIndexes.every(i=>Number.isInteger(i) && i>=0 && i<materials.length),'语料关联的素材索引错误（最多 3 个）；小作文应为空数组。');
    const textEn = english(e.textEn,'语料英文',500);
    assert(answer.textEn.toLowerCase().includes(textEn.toLowerCase()),`语料“${textEn}”不在英文答案中，无法高光。请让 AI 原样摘录答案中的表达。`);
    return {textEn,meaningZh:text(e.meaningZh,'语料释义',1000),category:text(e.category,'语料类型',100),categoryEn:english(e.categoryEn,'英文语料类别',200),exampleEn:english(e.exampleEn,'语料例句',2000),usageNote:text(e.usageNote,'使用提示',2000),usageNoteEn:english(e.usageNoteEn,'英文使用提示',2000),tags:tags(e.tags),materialIndexes:[...new Set(e.materialIndexes)]};
  });
  for(let i=0;i<materials.length;i++) assert(expressions.filter(e=>e.materialIndexes.includes(i)).length<=3,'每个素材元仅关联本次最相关的 3 条表达；其他表达可独立入库。');
  assert(expressions.length>0,'请至少提取一条出现在答案中的好词句。');
  assert(Array.isArray(result.answer.materialSpans) && result.answer.materialSpans.length<=100,'缺少素材句子标注，请按新提示词返回 answer.materialSpans。');
  const materialSpans=result.answer.materialSpans.map(span=> {
    assert(span && Number.isInteger(span.materialIndex) && span.materialIndex>=0 && span.materialIndex<materials.length,'素材句子标注的索引错误；小作文应返回空数组。');
    const quote=text(span.quote,'素材标注原句',15000);
    const start=answer.textEn.indexOf(quote);
    assert(start>=0 && answer.textEn.indexOf(quote,start+1)<0,'标注原句必须在答案中唯一且原样出现。请使用完整句子而非重复短语。');
    return {start,end:start+quote.length,materialIndex:span.materialIndex};
  }).sort((a,b)=>a.start-b.start);
  for(let i=1;i<materialSpans.length;i++) assert(materialSpans[i].start>=materialSpans[i-1].end,'不同素材标注不能重叠；同一句请选择最主要素材。');
  assert(question.scope==='writing-task1' || materials.every((_,i)=>materialSpans.some(s=>s.materialIndex===i)),'每个素材元都应有对应答案原句的颜色标注。');
  const perMaterial = new Map();
  const recommendations = result.recommendations.map(r=> {
    assert(r && typeof r==='object' && !Array.isArray(r),'推荐格式错误。');
    assert(Number.isInteger(r.materialIndex) && r.materialIndex>=0 && r.materialIndex<materials.length,'推荐素材索引错误。');
    assert(candidates.some(q=>q.id===r.questionId && q.scope===job.scope) && r.questionId!==question.id,'推荐题目必须属于本次候选列表，且不能跨口语/作文库。');
    assert(typeof r.score==='number' && Number.isFinite(r.score) && r.score>0 && r.score<=1,'推荐相关度应在 0 到 1 之间。');
    const set = perMaterial.get(r.materialIndex) ?? new Set(); set.add(r.questionId); perMaterial.set(r.materialIndex,set);
    assert(set.size<=3,'每个素材元最多向 3 道相关题推送。');
    return {materialIndex:r.materialIndex,questionId:r.questionId,score:r.score,reason:text(r.reason,'推荐理由',1000)};
  });
  return {passed:true,answer,wordCount:count,materials,expressions,recommendations,materialSpans};
}
