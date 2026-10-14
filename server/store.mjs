import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { assert, AppError, text, tags, scopes, uid, now, day, wordCount, recommendMaterials, recommendExpressions } from './domain.mjs';
import { assessExpression } from './corpus.mjs';

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('speaking','writing-task1','writing-task2')), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id), source_id TEXT NOT NULL REFERENCES sources(id), scope TEXT NOT NULL CHECK(scope IN ('speaking','writing-task1','writing-task2')), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('speaking','writing-task2')), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS material_revisions(id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS expressions(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('speaking','writing-task1','writing-task2')), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts(question_id TEXT PRIMARY KEY REFERENCES questions(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS answers(id TEXT PRIMARY KEY, question_id TEXT NOT NULL UNIQUE REFERENCES questions(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS words(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('speaking','writing-task1','writing-task2')), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS material_questions(material_id TEXT NOT NULL REFERENCES materials(id), question_id TEXT NOT NULL REFERENCES questions(id), score REAL NOT NULL CHECK(score > 0 AND score <= 1), reason TEXT NOT NULL, PRIMARY KEY(material_id,question_id));
CREATE TABLE IF NOT EXISTS material_expressions(material_id TEXT NOT NULL REFERENCES materials(id), expression_id TEXT NOT NULL REFERENCES expressions(id), score REAL NOT NULL CHECK(score > 0 AND score <= 1), reason TEXT NOT NULL, PRIMARY KEY(material_id,expression_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans(date TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batch_jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_states(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_events(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS topic_scope BEFORE INSERT ON questions WHEN (SELECT scope FROM topics WHERE id=NEW.topic_id) != NEW.scope BEGIN SELECT RAISE(ABORT,'题目与主题必须同库'); END;
CREATE TRIGGER IF NOT EXISTS mq_scope BEFORE INSERT ON material_questions WHEN (SELECT scope FROM materials WHERE id=NEW.material_id) != (SELECT scope FROM questions WHERE id=NEW.question_id) BEGIN SELECT RAISE(ABORT,'素材与题目不得跨库'); END;
CREATE TRIGGER IF NOT EXISTS me_scope BEFORE INSERT ON material_expressions WHEN (SELECT scope FROM materials WHERE id=NEW.material_id) != (SELECT scope FROM expressions WHERE id=NEW.expression_id) BEGIN SELECT RAISE(ABORT,'素材与语料不得跨库'); END;
`;
const defaults = {targetBand:'7.0',examType:'academic',provider:'web-bridge',dailySpeaking:2,dailyWriting:1};
const entities = ['sources','topics','questions','materials','material_revisions','expressions','drafts','jobs','answers','revisions','words','plans','batch_jobs','review_states','review_events'];
const json = JSON.stringify;
const validId = v => text(v,'记录 ID',150);
const scopeOf = v => {assert(scopes.includes(v),'未知资料库。'); return v;};

export class Store {
  constructor({file=resolve(process.env.YASY_DATA_DIR || '.local','yasy.sqlite'),bankPath=resolve('data/question-bank.json'),bank}={}) {
    this.file = file;
    if (file!==':memory:') mkdirSync(dirname(file),{recursive:true});
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec(schema);
    this.bank = bank ?? (existsSync(bankPath) ? JSON.parse(readFileSync(bankPath,'utf8')) : {sources:[],topics:[],questions:[]});
    this.seed(this.bank);
    if (!this.db.prepare("SELECT key FROM settings WHERE key='main'").get()) this.setSettings(defaults);
    this.reviewLegacyExpressions();
  }
  close() {this.db.close();}
  all(table) {assert(entities.includes(table),'未知数据表。'); return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(r.data));}
  get(table,id) {assert(entities.includes(table),'未知数据表。'); const column=table==='drafts' ? 'question_id' : table==='plans' ? 'date' : 'id'; const row=this.db.prepare(`SELECT data FROM ${table} WHERE ${column}=?`).get(id); return row ? JSON.parse(row.data) : undefined;}
  question(id) {const q=this.get('questions',id); assert(q,'题目不存在。',404); return q;}
  transaction(action) {this.db.exec('BEGIN IMMEDIATE'); try {const result=action(); this.db.exec('COMMIT'); return result;} catch(e) {this.db.exec('ROLLBACK');throw e;}}
  insert(table,obj,replace=true) {
    const columns = table==='questions' ? ['id','topic_id','source_id','scope','data'] : table==='material_revisions' ? ['id','material_id','data'] : ['topics','materials','expressions','words'].includes(table) ? ['id','scope','data'] : table==='drafts' ? ['question_id','data'] : table==='plans' ? ['date','data'] : ['answers','revisions','jobs'].includes(table) ? ['id','question_id','data'] : ['id','data'];
    const values=columns.map(c=>c==='data' ? json(obj) : c==='question_id' ? obj.questionId : c==='material_id' ? obj.materialId : c==='topic_id' ? obj.topicId : c==='source_id' ? obj.sourceId : obj[c]);
    // ON CONFLICT updates preserve row identity and avoid SQLite REPLACE deleting children.
    const key=columns[0];
    const conflict=replace ? `ON CONFLICT(${key}) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=excluded.${c}`).join(',')}` : '';
    this.db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ${conflict}`).run(...values);
  }
  seed(bank) {
    this.transaction(()=> {
      const generation=bank.generation;
      const installed=this.db.prepare("SELECT data FROM settings WHERE key='bank-generation'").get();
      // A published replacement is an installation, not a startup overwrite.
      // Later imports and explicitly restored snapshots remain authoritative.
      if(bank.replaceExisting && generation && installed?.data===generation) return;
      if(bank.replaceExisting && generation && installed?.data!==generation) {
        const ids=new Set(bank.questions.map(q=>q.id));
        for(const q of this.all('questions').filter(q=>!ids.has(q.id))) this.insert('questions',{...q,active:false});
        for(const job of this.all('jobs').filter(j=>!ids.has(j.questionId) && ['pending','processing','failed'].includes(j.status))) this.insert('jobs',{...job,status:'needs-revision',error:'题库已替换，此题仅保留历史内容。'});
        this.db.prepare('DELETE FROM plans WHERE date=?').run(day());
        this.db.prepare("INSERT INTO settings(key,data) VALUES('bank-generation',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(generation);
      }
      for (const s of bank.sources) this.insert('sources',s);
      for (const t of bank.topics) this.insert('topics',t);
      for (const q of bank.questions) this.insert('questions',q);
    });
  }
  settings() {return JSON.parse(this.db.prepare("SELECT data FROM settings WHERE key='main'").get().data);}
  setSettings(input) {
    const old=this.db.prepare("SELECT data FROM settings WHERE key='main'").get();
    const settings={...defaults,...(old ? JSON.parse(old.data) : {}),...input};
    assert(['5.5','6.0','6.5','7.0','7.5','8.0','8.5','9.0'].includes(settings.targetBand),'目标分数格式错误。');
    assert(settings.examType==='academic','当前版本仅收录 Academic；General Training 已预留，尚未上线。');
    assert(['web-bridge','iiiapi'].includes(settings.provider),'未知 AI 处理方式。');
    assert(Number.isInteger(settings.dailySpeaking) && settings.dailySpeaking>=0 && settings.dailySpeaking<=20,'每日口语数量应为 0–20。');
    assert(Number.isInteger(settings.dailyWriting) && settings.dailyWriting>=0 && settings.dailyWriting<=10,'每日作文数量应为 0–10。');
    this.db.prepare("INSERT INTO settings(key,data) VALUES('main',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(json(settings));
    return settings;
  }
  links() {return [...this.db.prepare('SELECT material_id AS fromId,question_id AS toId,score,reason FROM material_questions').all().map(l=>({...l,kind:'material-question'})),...this.db.prepare('SELECT material_id AS fromId,expression_id AS toId,score,reason FROM material_expressions').all().map(l=>({...l,kind:'material-expression'}))];}
  link(l) {const table=l.kind==='material-question' ? 'material_questions' : 'material_expressions'; const col=l.kind==='material-question' ? 'question_id' : 'expression_id'; this.db.prepare(`INSERT INTO ${table}(material_id,${col},score,reason) VALUES(?,?,?,?) ON CONFLICT(material_id,${col}) DO UPDATE SET score=excluded.score,reason=excluded.reason`).run(l.fromId,l.toId,l.score,l.reason);}
  plan() {
    const date=day(); const existing=this.get('plans',date); if (existing) return existing;
    const answered=new Set(this.all('answers').map(a=>a.questionId));
    const pending=this.all('questions').filter(q=>q.active!==false && !answered.has(q.id));
    const s=this.settings();
    const plan={date,questionIds:[...pending.filter(q=>q.scope==='speaking').slice(0,s.dailySpeaking),...pending.filter(q=>q.scope!=='speaking').sort((a,b)=>a.scope==='writing-task2' ? -1 : b.scope==='writing-task2' ? 1 : 0).slice(0,s.dailyWriting)].map(q=>q.id)};
    this.insert('plans',plan); return plan;
  }
  setPlan(ids) {assert(Array.isArray(ids) && ids.length<=30 && ids.every(i=>typeof i==='string'),'今日计划格式错误。'); ids.forEach(i=>assert(this.question(i).active!==false,'已归档题目不能加入新的今日计划。',409));const plan={date:day(),questionIds:[...new Set(ids)]};this.insert('plans',plan);return plan;}
  state() {
    const settings=this.settings();const questions=this.all('questions').filter(q=>q.active!==false);const topicIds=new Set(questions.map(q=>q.topicId));
    return Object.fromEntries([...['sources','answers','materials','expressions','words','drafts','jobs'].map(t=>[t,this.all(t)]),['questions',questions],['archivedQuestions',this.all('questions').filter(q=>q.active===false)],['topics',this.all('topics').filter(t=>topicIds.has(t.id))],['links',this.links()],['settings',settings],['dailyPlan',this.plan()],['storage',{kind:'SQLite',location:this.file}],['provider',{id:settings.provider,label:settings.provider==='iiiapi' ? 'iiiapi API' : 'ChatGPT 网页桥接',automated:settings.provider==='iiiapi'}]]);
  }
  reviewLegacyExpressions() {
    for(const expression of this.all('expressions').filter(e=>!e.admission || e.admission.policyVersion!==2)) this.insert('expressions',{...expression,admission:assessExpression(expression,{scope:expression.scope})});
  }
  materialHistory(id) {const material=this.get('materials',id);assert(material,'素材不存在。',404);return {material,versions:this.all('material_revisions').filter(r=>r.materialId===id).sort((a,b)=>b.version-a.version)};}
  validateMaterials(question,ids) {assert(Array.isArray(ids) && ids.length<=3 && new Set(ids).size===ids.length,'最多可选择 3 个不同素材元。'); assert(question.scope!=='writing-task1' || !ids.length,'小作文不使用素材元。'); return ids.map(id=> {const m=this.get('materials',id);assert(m && m.scope===question.scope,'选择的素材不存在或来自其他库。');return m;});}
  saveDraft(id,input) {const q=this.question(id);assert(q.active!==false,'此题已归档，仅可查看。',409); const textZh=text(input.textZh,'中文素材',20000,true);const materialIds=input.materialIds ?? [];this.validateMaterials(q,materialIds);const draft={questionId:id,textZh,materialIds,updatedAt:now()};this.insert('drafts',draft);return draft;}
  candidates(question) {
    return this.all('questions').filter(q=>q.active!==false && q.scope===question.scope && q.id!==question.id).map(q=>({q,score:(q.topicId===question.topicId ? 5 : 0)+q.tags.filter(t=>question.tags.includes(t)).length})).sort((a,b)=>b.score-a.score).map(x=> {
      const {id,scope,part,titleZh,promptEn,tags,cuePoints}=x.q;
      return {id,scope,part,titleZh,promptEn,tags,...(cuePoints?.length ? {cuePoints} : {})};
    });
  }
  recommendations(id) {const q=this.question(id);const materials=this.all('materials'),expressions=this.all('expressions').filter(e=>e.admission?.status==='approved'),links=this.links();return {materials:recommendMaterials(q,materials,links),expressions:recommendExpressions(q,expressions,links,materials)};}
  saveJob(job) {this.transaction(()=>{for(const old of this.all('jobs').filter(j=>j.questionId===job.questionId && ['pending','processing','failed'].includes(j.status))) this.insert('jobs',{...old,status:'needs-revision'});this.insert('jobs',job);});return job;}
  importResult(job,validated) {
    return this.transaction(()=>{
      this.assertPendingJob(job.id);
      const stamp=now();
      const materialIds=validated.materials.map(m=> {
        const {existingMaterialId,...data}=m;
        const same=m=>m.title===data.title && m.summaryZh===data.summaryZh && m.detailZh===data.detailZh && m.summaryEn===data.summaryEn && m.detailEn===data.detailEn && json([...m.tags].sort())===json([...data.tags].sort());
        const old=existingMaterialId ? this.get('materials',existingMaterialId) : this.all('materials').find(x=>x.scope===job.scope && same(x));
        if(existingMaterialId) {
          assert(old && old.scope===job.scope,'选中的原素材不存在或来自其他库。');
          const version=old.version ?? 1;const expected=job.materialVersions?.[old.id];
          assert(expected===undefined || expected===version,'这个素材已被另一道题补充更新，旧版本结果未保存。请重新选择最新素材后处理。',409);
          if(!same(old)) {
            assert(expected!==undefined,'这份旧任务未记录素材版本。请重新生成任务后补充原素材。',409);
            this.insert('material_revisions',{id:uid('matrev'),materialId:old.id,version,questionId:job.questionId,jobId:job.id,createdAt:stamp,snapshot:{...old,version}});
            this.insert('materials',{...old,...data,version:version+1,updatedAt:stamp});
          }
          return old.id;
        }
        if(old) return old.id;
        const material={id:uid('mat'),scope:job.scope,...data,version:1,createdAt:stamp,updatedAt:stamp};this.insert('materials',material);return material.id;
      });
      const expressionIds=validated.expressions.map(e=> {
        const {materialIndexes,...data}=e;
        const old=this.all('expressions').find(x=>x.scope===job.scope && x.textEn.toLowerCase()===data.textEn.toLowerCase() && x.meaningZh===data.meaningZh);
        const expression={...(old ?? {id:uid('exp'),createdAt:stamp}),scope:job.scope,...data};
        this.insert('expressions',expression);
        materialIndexes.forEach(i=>this.link({kind:'material-expression',fromId:materialIds[i],toId:expression.id,score:1,reason:'本次答案中采用此表达'}));return expression.id;
      });
      materialIds.forEach(id=>this.link({kind:'material-question',fromId:id,toId:job.questionId,score:1,reason:'本题答案使用的真实素材'}));
      validated.recommendations.forEach(r=>this.link({kind:'material-question',fromId:materialIds[r.materialIndex],toId:r.questionId,score:r.score,reason:r.reason}));
      const old=this.all('answers').find(a=>a.questionId===job.questionId);
      if(old) this.insert('revisions',{...old,id:uid('rev')});
      const answer={id:old?.id ?? uid('ans'),questionId:job.questionId,...validated.answer,wordCount:validated.wordCount,materialIds:[...new Set(materialIds)],materialVersions:Object.fromEntries(materialIds.map(id=>[id,this.get('materials',id).version ?? 1])),materialSnapshots:materialIds.map(id=>this.get('materials',id)),expressionIds:[...new Set(expressionIds)],materialSpans:validated.materialSpans.map(s=>({start:s.start,end:s.end,materialId:materialIds[s.materialIndex]})),updatedAt:stamp,jobId:job.id};
      this.insert('answers',answer);
      this.insert('jobs',{...job,status:'completed',finishedAt:stamp,corpusReview:validated.corpusReview ?? []});
      return answer;
    });
  }
  assertPendingJob(id) {
    const job=this.get('jobs',id);
    assert(job,'AI 任务不存在。',404);
    assert(job.status==='pending','该任务已处理或被新任务替代。请生成新的提示词。',409);
    assert(this.question(job.questionId).active!==false,'该题已归档，仅可查看。',409);
    for(const [id,version] of Object.entries(job.materialVersions ?? {})) assert((this.get('materials',id)?.version ?? 1)===version,'所选素材已被其他题目更新。请重新选择最新素材并创建任务。',409);
    const draft=this.get('drafts',job.questionId);
    assert(draft && draft.textZh===job.textZh && JSON.stringify(draft.materialIds)===JSON.stringify(job.materialIds),'草稿已修改，这份 AI 结果对应旧素材。请重新生成提示词。',409);
    return job;
  }
  addWord(input) {
    const scope=scopeOf(input.scope); const textEn=text(input.textEn,'单词 / 短语',200);
    if(input.questionId) assert(this.question(input.questionId).scope===scope,'单词来源题目与所属库不一致。');
    const existing=this.all('words').find(w=>w.scope===scope && w.textEn.toLowerCase()===textEn.toLowerCase());
    const word={id:existing?.id ?? uid('word'),textEn,meaningZh:text(input.meaningZh || existing?.meaningZh || '','释义',1000,true),exampleEn:text(input.exampleEn || existing?.exampleEn || '','例句',2000,true),scope,...(input.questionId || existing?.questionId ? {questionId:input.questionId || existing.questionId} : {}),createdAt:existing?.createdAt ?? now()};
    this.insert('words',word);return word;
  }
  deleteWord(id) {assert(this.get('words',id),'单词不存在。',404);this.transaction(()=>{this.db.prepare('DELETE FROM words WHERE id=?').run(id);this.db.prepare('DELETE FROM review_states WHERE id=?').run(`word:${id}`);});}
  backup() {return {format:'yasy-backup',version:1,exportedAt:now(),bank:{sources:this.all('sources'),topics:this.all('topics'),questions:this.all('questions')},learning:Object.fromEntries([...['materials','material_revisions','expressions','answers','revisions','words','drafts','jobs','plans','batch_jobs','review_states','review_events'].map(t=>[t,this.all(t)]),['links',this.links()],['settings',this.settings()]])};}
  previousBackup() {const row=this.db.prepare("SELECT data FROM settings WHERE key='before-restore'").get();return row ? JSON.parse(row.data) : undefined;}
  restore(backup) {
    validateBackup(backup);
    // Save a recoverable pre-restore snapshot, including all user-owned records.
    const previous=this.backup();
    this.transaction(()=> {
      this.db.exec('DELETE FROM material_questions;DELETE FROM material_expressions;DELETE FROM material_revisions;DELETE FROM revisions;DELETE FROM answers;DELETE FROM drafts;DELETE FROM jobs;DELETE FROM words;DELETE FROM expressions;DELETE FROM materials;DELETE FROM plans;DELETE FROM questions;DELETE FROM topics;DELETE FROM sources;DELETE FROM batch_jobs;DELETE FROM review_states;DELETE FROM review_events;');
      for(const t of ['sources','topics','questions']) for(const obj of backup.bank[t]) this.insert(t,obj,false);
      for(const t of ['materials','expressions','jobs','drafts','answers','revisions','words','plans']) for(const obj of backup.learning[t]) this.insert(t,obj,false);
      for(const job of this.all('jobs').filter(j=>j.status==='processing')) this.insert('jobs',{...job,status:'failed',error:'备份中的 API 处理尚未完成。请确认素材后重试。'});
      for(const t of ['material_revisions','batch_jobs','review_states','review_events']) for(const obj of backup.learning[t] ?? []) this.insert(t,obj,false);
      for(const job of this.all('batch_jobs').filter(j=>j.status==='processing')) this.insert('batch_jobs',{...job,status:'failed',error:'备份中的文件提取未完成，请重新处理。'});
      backup.learning.links.forEach(l=>this.link(l));
      this.setSettings(backup.learning.settings);
      validateRelations(this);
      this.reviewLegacyExpressions();
      if(this.bank.replaceExisting && this.bank.generation) this.db.prepare("INSERT INTO settings(key,data) VALUES('bank-generation',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(this.bank.generation);
      this.db.prepare("INSERT INTO settings(key,data) VALUES('before-restore',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(json(previous));
    });
  }
}

function validateBackup(b) {
  assert(b?.format==='yasy-backup' && b.version===1,'这不是支持的 Yasy 备份（v1）。');
  assert(b.bank && b.learning,'备份缺少题库或学习资料。');
  for(const t of ['sources','topics','questions']) assert(Array.isArray(b.bank[t]) && b.bank[t].length<=10000,`备份题库 ${t} 格式错误。`);
  for(const t of ['materials','expressions','answers','revisions','words','drafts','jobs','plans','links']) assert(Array.isArray(b.learning[t]) && b.learning[t].length<=50000,`备份资料 ${t} 格式错误。`);
  for(const t of ['material_revisions','batch_jobs','review_states','review_events']) assert(b.learning[t]===undefined || (Array.isArray(b.learning[t]) && b.learning[t].length<=50000),`备份 ${t} 格式错误。`);
  assert(b.learning.settings && typeof b.learning.settings==='object','缺少设置。');
  for(const [t,list] of [...Object.entries(b.bank),...Object.entries(b.learning)].filter(([t])=>entities.includes(t))) {
    const ids=new Set();
    for(const o of list) {
      assert(o && typeof o==='object' && !Array.isArray(o),`备份 ${t} 记录格式错误。`);
      const id=t==='drafts' ? o.questionId : t==='plans' ? o.date : o.id;
      validId(id);assert(!ids.has(id),'备份包含重复记录。');ids.add(id);
      if(t==='sources') {text(o.title,'来源名',500);assert(/^https?:\/\//.test(o.url) || /^\/api\/(batches|sources)\/[A-Za-z0-9_-]+\/file$/.test(o.url),'题目来源链接无效。');assert(['official','reported','user-upload'].includes(o.type),'来源类型错误。');text(o.accessedAt,'访问日期',50);text(o.note,'来源说明',5000,true);}
      if(['topics','questions','materials','expressions','words','jobs'].includes(t)) scopeOf(o.scope);
      if(['topics','questions','materials','expressions'].includes(t)) tags(o.tags);
      if(t==='topics') {text(o.titleZh,'主题名',300);text(o.titleEn,'主题英文',300);text(o.description,'主题说明',3000,true);}
      if(t==='questions') {validId(o.topicId);validId(o.sourceId);text(o.promptEn,'题干',10000);text(o.promptZh,'中文题干',10000);text(o.titleZh,'题目名',500);assert(['official','reported','adapted'].includes(o.sourceType),'题目来源类型错误。');}
      if(t==='materials') {assert(o.scope!=='writing-task1','小作文不能恢复素材元。');text(o.title,'素材名',200);text(o.summaryZh,'素材摘要',3000);text(o.detailZh,'素材详情',15000);for(const k of ['summaryEn','detailEn']) if(o[k]!==undefined) text(o[k],k,15000);}
      if(t==='material_revisions') {validId(o.materialId);assert(Number.isInteger(o.version) && o.version>0 && o.snapshot?.id===o.materialId,'素材历史版本格式错误。');}
      if(t==='expressions') {for(const k of ['textEn','meaningZh','category','exampleEn','usageNote']) text(o[k],k,5000);for(const k of ['categoryEn','usageNoteEn']) if(o[k]!==undefined) text(o[k],k,5000);}
      if(t==='words') {text(o.textEn,'单词',200);text(o.meaningZh,'释义',1000,true);text(o.exampleEn,'例句',2000,true);}
      if(t==='drafts') {text(o.textZh,'草稿',20000,true);assert(Array.isArray(o.materialIds),'草稿素材错误。');}
      if(t==='jobs') {text(o.prompt,'提示词',1000000);text(o.textZh,'素材',20000);assert(['pending','processing','failed','completed','needs-revision'].includes(o.status),'任务状态错误。');assert(Array.isArray(o.materialIds),'任务素材错误。');const candidates=o.candidateIds ?? [];assert(Array.isArray(candidates) && candidates.length<=10000 && new Set(candidates).size===candidates.length,'任务候选题列表错误。');candidates.forEach(validId);if(o.materialVersions!==undefined) assert(o.materialVersions && typeof o.materialVersions==='object' && Object.entries(o.materialVersions).every(([id,v])=>o.materialIds.includes(id) && Number.isInteger(v) && v>0),'任务素材版本快照错误。');}
      if(t==='answers' || t==='revisions') {text(o.textEn,'答案',15000);text(o.outlineZh,'结构',5000);assert(o.wordCount===wordCount(o.textEn),'答案词数不一致。');assert(Array.isArray(o.materialIds) && Array.isArray(o.expressionIds),'答案关联格式错误。');}
      if(t==='plans') {assert(/^\d{4}-\d{2}-\d{2}$/.test(o.date) && Array.isArray(o.questionIds),'计划格式错误。');}
      if(t==='review_states' || t==='review_events') {assert(['answer','word'].includes(o.kind),'背诵记录类型错误。');validId(o.targetId);assert(Number.isInteger(o.reviewCount) && o.reviewCount>0 && Number.isFinite(Date.parse(o.dueAt)),'背诵次数或日期错误。');}
      if(t==='batch_jobs') {text(o.filename,'原文件名',200);assert(['pending','processing','failed','previewed','completed'].includes(o.status),'批量任务状态错误。');assert(['mixed',...scopes].includes(o.scope),'批量任务资料库错误。');text(o.prompt,'批量提示词',200000);assert(['pdf','doc','docx'].includes(o.extension),'上传文件扩展名错误。');}
    }
  }
  for(const l of b.learning.links) {validId(l.fromId);validId(l.toId);assert(['material-question','material-expression'].includes(l.kind),'备份关联类型错误。');assert(typeof l.score==='number' && l.score>0 && l.score<=1,'备份相关度错误。');text(l.reason,'关联理由',1000);}
}
function validateRelations(store) {
  const state=store.state();
  for(const draft of state.drafts) store.validateMaterials(store.question(draft.questionId),draft.materialIds);
  for(const job of state.jobs) {assert(job.scope===store.question(job.questionId).scope,'任务与题目跨库。');store.validateMaterials(store.question(job.questionId),job.materialIds);for(const id of job.candidateIds ?? []) assert(id!==job.questionId && store.question(id).scope===job.scope,'任务候选题来自其他库或为当前题。');}
  for(const answer of [...state.answers,...store.all('revisions')]) {
    const q=store.question(answer.questionId);
    const job=store.get('jobs',answer.jobId);assert(job && job.questionId===q.id && job.status==='completed','答案缺少已完成的对应任务。');
    assert(answer.materialIds.every(id=>store.get('materials',id)?.scope===q.scope),'答案素材关联错误。');
    assert(answer.expressionIds.every(id=>store.get('expressions',id)?.scope===q.scope),'答案语料关联错误。');
    assert(answer.materialSpans===undefined || Array.isArray(answer.materialSpans),'答案素材标注格式错误。');
    for(const span of answer.materialSpans ?? []) assert(span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start>=0 && span.end>span.start && span.end<=answer.textEn.length && answer.materialIds.includes(span.materialId),'答案素材标注范围或关联错误。');
  }
  for(const word of state.words) if(word.questionId) assert(store.question(word.questionId).scope===word.scope,'单词来源跨库。');
  for(const revision of store.all('material_revisions')) {const material=store.get('materials',revision.materialId);assert(material && revision.snapshot.scope===material.scope,'素材历史记录关联错误。');}
  for(const plan of store.all('plans')) plan.questionIds.forEach(id=>store.question(id));
  for(const review of store.all('review_states')) assert(store.get(review.kind==='answer' ? 'answers' : 'words',review.targetId),'背诵状态引用的答案或单词不存在。');
}
