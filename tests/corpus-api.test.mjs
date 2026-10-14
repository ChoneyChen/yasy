import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { auditCorpus } from '../server/iiiapi.mjs';
import { approvedConfidence } from './admission-fixture.mjs';

const KEY = 'mock-corpus-private-key';
const source = { id: 'audit-source', title: 'Fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-14', note: 'Tests only' };
const topic = { id: 'audit-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: '', tags: ['learning'] };
const question = { id: 'audit-question', scope: 'speaking', part: 'Part 1', topicId: topic.id, sourceId: source.id, sourceType: 'adapted', titleZh: '学习', promptEn: 'Do you enjoy practising new skills?', promptZh: '你喜欢练习新技能吗？', tags: ['learning'] };
const bank = { sources: [source], topics: [topic], questions: [question] };

function fixture(t) {
  const store = new Store({ file: ':memory:', bank });
  t.after(() => store.close());
  const base = { scope: 'speaking', meaningZh: '建立信心', category: '情绪态度', categoryEn: 'Confidence',
    exampleEn: 'Practice can help build confidence.', usageNote: '描述练习带来的信心增长。',
    usageNoteEn: 'A natural verb-noun collocation describing confidence gained through practice.', tags: ['learning'], createdAt: '2026-01-01T00:00:00Z' };
  store.insert('expressions', { ...base, id: 'audit-useful', textEn: 'build confidence' });
  store.insert('expressions', { ...base, id: 'audit-basic', textEn: 'I think' });
  store.insert('answers', { id: 'audit-answer', questionId: question.id, scope: 'speaking',
    textEn: 'I think practising with friends can help me build confidence when I speak in public.',
    outlineZh: '观点与理由', materialIds: [], expressionIds: ['audit-useful', 'audit-basic'], materialSpans: [], updatedAt: '2026-01-01T00:00:00Z' });
  return store;
}

const decisions = () => ({ reviews: [
  { id: 'audit-useful', admission: { ...approvedConfidence } },
  { id: 'audit-basic', admission: { approved: false, reasonZh: '这是泛泛的基础立场填充，不具有独立学习价值。', reasonEn: 'This basic stance filler has no separate corpus learning benefit.', benefit: 'discourse', transferExampleEn: '' } },
] });

const completion = (result, extra = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: typeof result === 'string' ? result : JSON.stringify(result) }, ...extra }] });
function provider(handler) {
  const calls = [];
  return { calls,
    config: { public: () => ({ configured: true }), secret: () => ({ model: 'mock-model', apiKey: KEY }), redact: (value, snapshot) => String(value).replaceAll(KEY, '[redacted]').replaceAll(snapshot || 'never-key', '[redacted]') },
    request: async (path, options) => { calls.push({ path, ...options }); return handler(path, options); },
  };
}

test('audit includes its action and exact schema in the user message for models that need an explicit user task', async t => {
  const store = fixture(t);
  const before = store.all('expressions');
  const ai = provider((path, options) => {
    assert.equal(path, '/chat/completions');
    assert.equal(options.credential, KEY);
    assert.equal(options.body.model, 'mock-model');
    const user = options.body.messages.find(message => message.role === 'user').content;
    // The observed gateway returned a clarification for a bare JSON array.
    assert.throws(() => JSON.parse(user));
    assert.match(user, /请立即执行 Yasy 雅思语料准入复核/);
    assert.match(user, /不要询问我希望对JSON做什么/);
    assert.match(user, /仅返回一个符合下方Schema的完整JSON对象/);
    const schemaStart = user.indexOf('\n【结果JSON Schema】\n') + '\n【结果JSON Schema】\n'.length;
    const schemaEnd = user.indexOf('\n\n【待复核记录JSON】', schemaStart);
    const schema = JSON.parse(user.slice(schemaStart, schemaEnd));
    assert.deepEqual(schema.properties.reviews.items.properties.id.enum, ['audit-useful', 'audit-basic']);
    assert.deepEqual(schema.properties.reviews.items.properties.admission.properties.benefit.enum, ['collocation', 'idiomatic', 'precision', 'structure', 'discourse']);
    assert.equal(schema.properties.reviews.minItems, 2);
    assert.equal(schema.properties.reviews.maxItems, 2);
    assert.ok(!user.includes(KEY));
    return completion(decisions());
  });
  const result = await auditCorpus(store, ai);
  assert.deepEqual(result.counts, { approved: 1, rejected: 1, pending: 0 });
  assert.equal(result.reviewed, 2);
  assert.equal(store.all('expressions').length, before.length);
  for (const old of before) {
    const current = store.get('expressions', old.id);
    for (const [key, value] of Object.entries(old)) assert.deepEqual(current[key], value);
    assert.ok(current.reviewedAt);
  }
});

test('audit accepts text-block completion bodies but retains strict item identity and admission rules', async t => {
  const store = fixture(t);
  const encoded = JSON.stringify(decisions());
  const ai = provider(() => completion('', { message: { content: [{ type: 'text', text: encoded.slice(0, 100) }, { type: 'text', text: encoded.slice(100) }] } }));
  const result = await auditCorpus(store, ai);
  assert.deepEqual(result.counts, { approved: 1, rejected: 1, pending: 0 });
  assert.equal(store.get('expressions', 'audit-basic').admission.status, 'rejected');
});

test('prose, truncated output and credentials fail with no partial updates and no response-body leak', async t => {
  for (const kind of ['prose', 'length', 'credential']) {
    const store = fixture(t);
    const before = store.all('expressions');
    const result = decisions();
    result.reviews[0].admission.reasonEn = kind === 'credential' ? KEY : result.reviews[0].admission.reasonEn;
    const ai = provider(() => kind === 'prose' ? completion('Please clarify PRIVATE_BODY_CONTEXT what you want me to do with this JSON.')
      : completion(result, kind === 'length' ? { finish_reason: 'length' } : {}));
    await assert.rejects(auditCorpus(store, ai), error => error.status === 502 && !error.message.includes(KEY) && !error.message.includes('PRIVATE_BODY_CONTEXT'));
    assert.deepEqual(store.all('expressions'), before);
    ai.request = async () => completion(decisions());
    assert.equal((await auditCorpus(store, ai)).reviewed, 2, 'failure must release the in-flight audit lock');
  }
});

test('complete item coverage and known unique IDs are still mandatory after the format repair', async t => {
  for (const kind of ['missing', 'unknown', 'duplicate']) {
    const store = fixture(t);
    const before = store.all('expressions');
    const result = decisions();
    if (kind === 'missing') result.reviews.pop();
    if (kind === 'unknown') result.reviews[1].id = 'foreign-expression';
    if (kind === 'duplicate') result.reviews[1].id = result.reviews[0].id;
    await assert.rejects(auditCorpus(store, provider(() => completion(result))), error => error.status === 502);
    assert.deepEqual(store.all('expressions'), before);
  }
});

test('a model approval cannot bypass local basic-phrase rejection or create a new corpus record', async t => {
  const store = fixture(t);
  const result = decisions();
  result.reviews[1].admission = { ...approvedConfidence, transferExampleEn: 'I think the plan may work.' };
  const output = await auditCorpus(store, provider(() => completion(result)));
  assert.deepEqual(output.counts, { approved: 1, rejected: 1, pending: 0 });
  assert.equal(store.all('expressions').length, 2);
  assert.equal(store.get('expressions', 'audit-basic').textEn, 'I think');
});

test('concurrent audits and modified records preserve atomic ownership rather than overwriting newer data', async t => {
  const store = fixture(t);
  let release;
  let started;
  const dispatched = new Promise(resolve => { started = resolve; });
  const ai = provider(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const audit = auditCorpus(store, ai);
  await dispatched;
  await assert.rejects(auditCorpus(store, ai), error => error.status === 409);
  const changed = { ...store.get('expressions', 'audit-basic'), meaningZh: '较新人工修改' };
  store.insert('expressions', changed);
  release(completion(decisions()));
  await assert.rejects(audit, error => error.status === 409);
  assert.equal(store.get('expressions', 'audit-useful').admission, undefined);
  assert.deepEqual(store.get('expressions', 'audit-basic'), changed);
});
