import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { IIIAPIProvider } from '../server/iiiapi.mjs';
import { approvedConfidence } from './admission-fixture.mjs';

// All credentials, services and learning records in this file are synthetic.
// Each test injects its provider and creates SQLite only under a fresh temp dir.
const KEY = 'sk-learning-upgrade-fake-credential-123456789';
const MODEL = 'local-review-fixture';
const source = { id: 'upgrade-source', title: 'Synthetic local test', url: 'https://example.invalid/', type: 'reported', accessedAt: '2026-10-14', note: 'Synthetic test data only; no exam-source claim.' };
const topic = { id: 'upgrade-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: 'Test fixture', tags: ['learning'] };
const bank = {
  sources: [source], topics: [topic],
  questions: ['q1', 'q2', 'q3'].map((id, index) => ({ id, scope: 'speaking', topicId: topic.id, sourceId: source.id, sourceType: 'adapted', part: 'Part 1', titleZh: `学习问题${index + 1}`, promptEn: ['Do you enjoy studying with friends?', 'Why is encouragement useful?', 'How do you learn from other people?'][index], promptZh: '请说明自己的学习想法。', tags: ['learning'] })),
};
const draftZh = '我喜欢与朋友练习英语，因为互相鼓励让我有信心。我们分享真实经历，帮助彼此把想法表达清楚。';
const prose = 'I think learning English with friends helps me build confidence. We share our real experiences and encourage each other to express ideas clearly. Their support makes practice more enjoyable, and I feel more comfortable taking part in our discussions.';
const material = () => ({ title: 'Learning with friends', summaryZh: '朋友的鼓励帮助我更自信', summaryEn: 'Encouragement from friends builds confidence.', detailZh: draftZh, detailEn: prose, tags: ['learning'] });
const expression = (changes = {}) => ({ textEn: 'build confidence', meaningZh: '建立信心', category: '自然搭配', categoryEn: 'Natural collocations', exampleEn: 'Regular practice can help build confidence.', usageNote: '描述练习或鼓励带来的信心。', usageNoteEn: 'Use this collocation for confidence developed through practice or encouragement.', tags: ['learning'], materialIndexes: [0], admission: structuredClone(approvedConfidence), ...changes });
function resultFor(job, changes = {}) {
  return { requestId: job.id, questionId: job.questionId, scope: job.scope, quality: { passed: true, suggestions: [] }, answer: { textEn: prose, outlineZh: '直接回答，说明原因与实际收益。', materialSpans: [{ quote: prose, materialIndex: 0 }] }, materials: [material()], expressions: [expression()], recommendations: [], ...changes };
}
const completion = value => ({ model: MODEL, choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fakeConfig = () => ({ public: provider => ({ provider, configured: true, hasKey: true, model: MODEL }), secret: () => ({ apiKey: KEY, model: MODEL }), redact: value => String(value).replaceAll(KEY, '[redacted]') });
function fakeProvider() {
  return {
    config: fakeConfig(),
    generate: async job => ({ result: resultFor(job), model: MODEL, usage: { total_tokens: 1 } }),
    request: async () => { throw new Error('Unexpected mock request'); },
  };
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!server.listening) return; server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
async function fixture(t, provider = fakeProvider(), providerMode = 'iiiapi') {
  const dir = mkdtempSync(join(tmpdir(), 'yasy-learning-upgrade-'));
  const store = new Store({ file: join(dir, 'learning.sqlite'), bank });
  store.setSettings({ provider: providerMode });
  const server = createServer(createApp(store, { aiProvider: provider }));
  const base = await listen(server);
  t.after(async () => { await close(server); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(4000) });
    return { status: response.status, data: await response.json() };
  };
  const job = async (questionId = 'q1', extra = {}) => {
    const response = await api('/api/jobs', { questionId, textZh: draftZh, materialIds: [], ...extra });
    assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.job;
  };
  return { dir, store, provider, api, job };
}
async function until(check, message) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(message);
}
const answerFor = (store, id) => store.all('answers').find(answer => answer.questionId === id);

test('background 202 keeps other drafts and jobs writable and rejects duplicate dispatch', async t => {
  const provider = fakeProvider(); const gates = new Map();
  provider.generate = async job => { const gate = deferred(); gates.set(job.questionId, gate); await gate.promise; return { result: resultFor(job), model: MODEL }; };
  const f = await fixture(t, provider);
  const first = await f.job();
  const started = await f.api(`/api/jobs/${first.id}/generate`, { background: true });
  assert.equal(started.status, 202); assert.equal(started.data.job.status, 'processing');
  assert.equal((await f.api(`/api/jobs/${first.id}/generate`, { background: true })).status, 409);
  const otherDraft = `${draftZh}补充第二题的真实看法。`;
  assert.equal((await f.api('/api/drafts/q2', { textZh: otherDraft, materialIds: [] }, 'PUT')).status, 200);
  const second = await f.job('q2', { textZh: otherDraft });
  assert.equal((await f.api(`/api/jobs/${second.id}/generate`, { background: true })).status, 202);
  assert.equal(f.store.get('jobs', first.id).status, 'processing');
  assert.equal(f.store.get('drafts', 'q2').textZh, otherDraft);
  gates.get('q2').resolve(); await until(() => f.store.get('jobs', second.id).status === 'completed', 'the second background answer should finish');
  gates.get('q1').resolve(); await until(() => f.store.get('jobs', first.id).status === 'completed', 'the first background answer should finish after navigation');
  assert.equal(f.store.all('answers').length, 2); assert.ok(answerFor(f.store, 'q1')); assert.ok(answerFor(f.store, 'q2'));
  assert.equal(f.store.get('jobs', first.id).answerReview, undefined);
});

test('real provider makes exactly one completion, selects corpus in that response and never retries automatically', async t => {
  for (const outcome of ['pass', 'unquoted-corpus', 'missing-facts', 'malformed']) await t.test(outcome, async t => {
    const calls = []; let currentJob;
    const mock = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); calls.push({ path: req.url, authorization: req.headers.authorization, body });
      const value = outcome === 'missing-facts' ? resultFor(currentJob, { quality: { passed: false, suggestions: ['请补充核心事实。'] } })
        : outcome === 'malformed' ? 'Not valid JSON'
        : outcome === 'unquoted-corpus' ? resultFor(currentJob, { expressions: [expression({ textEn: 'establish and enforce a policy' })] }) : resultFor(currentJob);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(completion(value)));
    });
    const mockBase = await listen(mock); t.after(() => close(mock));
    const provider = new IIIAPIProvider({ config: fakeConfig(), baseUrl: `${mockBase}/v1`, timeoutMs: 2000 });
    const f = await fixture(t, provider); currentJob = await f.job();
    const response = await f.api(`/api/jobs/${currentJob.id}/generate`, {});
    assert.equal(calls.length, 1, 'one click must make one model completion, including failure cases');
    assert.equal(calls[0].path, '/v1/chat/completions'); assert.equal(calls[0].authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].body.messages[1].content, currentJob.prompt);
    assert.equal(JSON.stringify(calls[0].body).includes(KEY), false);
    if (outcome === 'pass' || outcome === 'unquoted-corpus') {
      assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(answerFor(f.store, 'q1').textEn, prose);
      assert.equal(answerFor(f.store, 'q1').expressionIds.length, outcome === 'pass' ? 1 : 0); assert.equal(f.store.get('jobs', currentJob.id).answerReview, undefined);
      if (outcome === 'unquoted-corpus') assert.equal(f.store.get('jobs', currentJob.id).corpusReview[0].status, 'rejected');
      assert.deepEqual(f.store.get('jobs', currentJob.id).usage, { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
    } else {
      assert.equal(response.status, outcome === 'missing-facts' ? 422 : 502); assert.equal(f.store.all('answers').length, 0); assert.equal(f.store.all('materials').length, 0);
      assert.equal(f.store.get('jobs', currentJob.id).status, outcome === 'missing-facts' ? 'needs-revision' : 'failed');
    }
  });
});

test('same-core material keeps its ID, versions bilingual changes and preserves old answer snapshots through restore', async t => {
  const f = await fixture(t);
  const first = await f.job(); assert.equal((await f.api(`/api/jobs/${first.id}/generate`, {})).status, 200);
  const originalAnswer = structuredClone(answerFor(f.store, 'q1')); const original = f.store.all('materials')[0];
  assert.equal(original.version, 1);
  const updatedZh = `${draftZh}我还补充了朋友如何认真听我说话并给出建议。`;
  const updatedEn = `${prose} My friends also listen carefully and offer advice.`;
  f.provider.generate = async job => ({ result: resultFor(job, { materials: [{ ...material(), existingMaterialId: original.id, detailZh: updatedZh, detailEn: updatedEn }] }), model: MODEL });
  const second = await f.job('q2', { textZh: updatedZh, materialIds: [original.id] });
  assert.deepEqual(second.materialVersions, { [original.id]: 1 });
  assert.equal((await f.api(`/api/jobs/${second.id}/generate`, {})).status, 200);
  const latest = f.store.get('materials', original.id);
  assert.equal(f.store.all('materials').length, 1); assert.equal(latest.version, 2); assert.equal(latest.detailZh, updatedZh); assert.equal(latest.detailEn, updatedEn);
  assert.deepEqual(answerFor(f.store, 'q1'), originalAnswer); assert.equal(originalAnswer.materialSnapshots[0].version, 1);
  assert.equal(answerFor(f.store, 'q2').materialSnapshots[0].version, 2);
  const history = await f.api(`/api/materials/${original.id}/history`);
  assert.equal(history.status, 200); assert.equal(history.data.versions.length, 1); assert.deepEqual(history.data.versions[0].snapshot, original);
  const backup = (await f.api('/api/backup')).data;
  const restored = new Store({ file: join(f.dir, 'restored.sqlite'), bank: { sources: [], topics: [], questions: [] } });
  try {
    restored.restore(backup); assert.deepEqual(restored.materialHistory(original.id), history.data);
    assert.deepEqual(answerFor(restored, 'q1').materialSnapshots, originalAnswer.materialSnapshots); assert.equal(answerFor(restored, 'q2').materialVersions[original.id], 2);
  } finally { restored.close(); }
});

test('concurrent same-base material updates reject the late result and roll back all partial writes', async t => {
  const f = await fixture(t); const first = await f.job(); assert.equal((await f.api(`/api/jobs/${first.id}/generate`, {})).status, 200);
  const original = f.store.all('materials')[0]; const gates = new Map();
  f.provider.generate = async job => {
    const gate = deferred(); gates.set(job.questionId, gate); await gate.promise;
    const changed = { ...material(), existingMaterialId: original.id, detailZh: `${draftZh}${job.questionId === 'q2' ? '朋友给了建议。' : '朋友陪我练习。'}`, detailEn: `${prose} ${job.questionId === 'q2' ? 'My friends gave me advice.' : 'My friends practised with me.'}` };
    if (job.questionId === 'q2') return { result: resultFor(job, { materials: [changed] }), model: MODEL };
    const extraText = 'I also enjoy reading alone because it gives me time to think carefully. It helps me understand the topic before discussing my ideas with friends.';
    return { result: resultFor(job, { answer: { textEn: `${extraText} ${prose}`, outlineZh: '不同素材分别展开。', materialSpans: [{ quote: extraText, materialIndex: 0 }, { quote: prose, materialIndex: 1 }] }, materials: [{ ...material(), title: 'Independent reading', summaryZh: '先独立阅读，再交流', summaryEn: 'Independent reading before discussion.', detailZh: '我喜欢先独立阅读，认真思考后再与朋友讨论。', detailEn: extraText }, changed], expressions: [] }), model: MODEL };
  };
  const early = await f.job('q2', { materialIds: [original.id] }); const late = await f.job('q3', { materialIds: [original.id] });
  assert.equal(early.materialVersions[original.id], 1); assert.equal(late.materialVersions[original.id], 1);
  assert.equal((await f.api(`/api/jobs/${early.id}/generate`, { background: true })).status, 202);
  assert.equal((await f.api(`/api/jobs/${late.id}/generate`, { background: true })).status, 202);
  gates.get('q2').resolve(); await until(() => f.store.get('jobs', early.id).status === 'completed', 'early update should finish');
  const preserved = structuredClone(f.store.get('materials', original.id));
  gates.get('q3').resolve(); await until(() => f.store.get('jobs', late.id).status === 'failed', 'late conflicting update should fail');
  assert.match(f.store.get('jobs', late.id).error, /素材.*更新|版本/);
  assert.deepEqual(f.store.get('materials', original.id), preserved); assert.equal(preserved.version, 2);
  assert.equal(f.store.all('materials').length, 1, 'new material inserted earlier in the failed transaction must roll back');
  assert.equal(f.store.all('material_revisions').length, 1); assert.equal(answerFor(f.store, 'q3'), undefined);
  assert.equal(f.store.links().some(link => link.toId === 'q3'), false); assert.equal(f.store.all('answers').length, 2);
});

test('zero approved corpus entries still save the answer, rejected candidates survive only as job review', async t => {
  const f = await fixture(t);
  f.provider.generate = async job => ({ result: resultFor(job, { expressions: [expression({ admission: { ...approvedConfidence, approved: false, reasonZh: '本次语境不值得专门积累。', reasonEn: 'This occurrence does not provide a useful learning benefit.' } }), expression({ textEn: 'I think', meaningZh: '我认为', admission: { ...approvedConfidence, benefit: 'discourse' } })] }), model: MODEL });
  const job = await f.job(); const response = await f.api(`/api/jobs/${job.id}/generate`, {});
  assert.equal(response.status, 200); assert.ok(answerFor(f.store, 'q1')); assert.equal(f.store.all('expressions').length, 0);
  assert.deepEqual(answerFor(f.store, 'q1').expressionIds, []); assert.equal(f.store.get('jobs', job.id).corpusReview.length, 2);
  assert.ok(f.store.get('jobs', job.id).corpusReview.every(entry => entry.status === 'rejected')); assert.match(f.store.get('jobs', job.id).corpusReview[0].reasonZh, /不值得/);
  f.provider.generate = async next => ({ result: resultFor(next, { expressions: [] }), model: MODEL });
  const next = await f.job('q2'); assert.equal((await f.api(`/api/jobs/${next.id}/generate`, {})).status, 200); assert.ok(answerFor(f.store, 'q2'));
});

test('Chinese ideas are bound previews, preserve existing drafts and reject malformed, foreign and credential echoes', async t => {
  const f = await fixture(t); let next; let requests = 0;
  f.provider.request = async path => { requests++; assert.equal(path, '/chat/completions'); return completion(next); };
  next = { questionId: 'q1', origin: 'generated', requiresConfirmation: true, draftZh: '我可以先想想与朋友一起学习时受到鼓励的经历，再确认是否符合真实情况。', notes: [] };
  const empty = await f.api('/api/ideas', { questionId: 'q1', textZh: '' });
  assert.equal(empty.status, 200); assert.equal(empty.data.origin, 'generated'); assert.equal(empty.data.requiresConfirmation, true); assert.match(empty.data.notes[0], /尚未核实/);
  assert.equal(f.store.get('drafts', 'q1'), undefined); assert.equal(f.store.all('jobs').length, 0); assert.equal(f.store.all('answers').length, 0);
  await f.api('/api/drafts/q1', { textZh: draftZh, materialIds: [] }, 'PUT'); const before = f.store.get('drafts', 'q1');
  next = { ...next, origin: 'refined', draftZh: `${draftZh}我可以先说原因，再说相互鼓励的细节。` };
  const refined = await f.api('/api/ideas', { questionId: 'q1', textZh: draftZh });
  assert.equal(refined.status, 200); assert.equal(refined.data.origin, 'refined'); assert.deepEqual(f.store.get('drafts', 'q1'), before);
  for (const invalid of ['not JSON', { ...next, questionId: 'q2' }, { ...next, origin: 'generated' }, { ...next, draftZh: `中文素材含不该返回的认证信息${KEY}` }]) {
    next = invalid; const response = await f.api('/api/ideas', { questionId: 'q1', textZh: draftZh });
    assert.equal(response.status, 502); assert.equal(JSON.stringify(response.data).includes(KEY), false); assert.deepEqual(f.store.get('drafts', 'q1'), before);
  }
  const count = requests;
  assert.equal((await f.api('/api/ideas', { questionId: 'q1', textZh: draftZh }, 'POST', { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal(requests, count, 'cross-site rejection must occur before any provider request');
  assert.equal((await f.api('/api/ideas', { questionId: 'missing', textZh: '' })).status, 404);
});

test('legacy corpus audit retains approved, rejected and pending records with their original IDs and content', async t => {
  const f = await fixture(t); const first = await f.job(); assert.equal((await f.api(`/api/jobs/${first.id}/generate`, {})).status, 200);
  const saved = answerFor(f.store, 'q1'); const existing = f.store.all('expressions')[0];
  const legacy = [
    { ...existing, id: 'legacy-useful', admission: undefined, createdAt: '2026-01-01T00:00:00Z' },
    { ...existing, id: 'legacy-basic', textEn: 'I think', admission: undefined, createdAt: '2026-01-02T00:00:00Z' },
    { ...existing, id: 'legacy-no-context', textEn: 'draw a distinction', admission: undefined, createdAt: '2026-01-03T00:00:00Z' },
  ];
  legacy.forEach(item => f.store.insert('expressions', item)); f.store.insert('answers', { ...saved, expressionIds: [...saved.expressionIds, 'legacy-useful', 'legacy-basic'] });
  f.store.reviewLegacyExpressions(); assert.equal(f.store.get('expressions', 'legacy-useful').admission.status, 'pending'); assert.equal(f.store.get('expressions', 'legacy-basic').admission.status, 'rejected');
  f.provider.request = async () => completion({ reviews: legacy.map(item => ({ id: item.id, admission: item.id === 'legacy-basic' ? { ...approvedConfidence, approved: false, reasonZh: '基础表达，没有独立积累价值。', reasonEn: 'This basic filler has no separate corpus learning value.' } : { ...approvedConfidence, transferExampleEn: item.id === 'legacy-no-context' ? 'We need to draw a distinction between these ideas.' : approvedConfidence.transferExampleEn } })) });
  const response = await f.api('/api/corpus/audit', { ids: legacy.map(item => item.id) });
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.deepEqual(response.data.counts, { approved: 1, rejected: 1, pending: 1 }); assert.equal(response.data.reviewed, 3);
  assert.equal(f.store.all('expressions').length, 4);
  for (const old of legacy) { const current = f.store.get('expressions', old.id); for (const key of ['textEn', 'meaningZh', 'createdAt', 'usageNoteEn', 'exampleEn']) assert.equal(current[key], old[key]); assert.ok(current.admission.reasonZh); assert.ok(current.admission.reasonEn); }
  assert.equal(f.store.get('expressions', 'legacy-no-context').admission.status, 'pending'); assert.equal(f.store.get('expressions', 'legacy-basic').admission.status, 'rejected');
  assert.ok(f.store.get('expressions', 'legacy-useful').reviewedAt); assert.equal((await f.api('/api/corpus/audit', { ids: ['unknown-expression'] })).status, 400);
});

test('iOS uses the shared API while the Mac keeps web mode and v1 remains read-only', async t => {
  const f = await fixture(t, fakeProvider(), 'web-bridge');
  const v2 = await f.api('/api/v2/manifest'); const v1 = await f.api('/api/v1/manifest');
  assert.equal(v2.status, 200); assert.equal(v2.data.deviceRole, 'full-client'); assert.equal(v2.data.readOnly, false); assert.equal(v2.data.connectivity, 'loopback-only'); assert.equal(v2.data.pairing, 'reserved');
  assert.deepEqual(v2.data.platformPolicy.iosProviders, ['iiiapi']); assert.equal(v2.data.endpoints.generate, '/api/jobs/{jobId}/generate');
  assert.equal(v1.data.readOnly, true); assert.equal(v1.data.deviceRole, 'full-reader');
  const job = await f.job('q1', { client: 'ios' }); assert.equal(job.provider, 'iiiapi'); assert.equal(job.client, 'ios'); assert.equal(f.store.settings().provider, 'web-bridge');
  assert.equal((await f.api(`/api/jobs/${job.id}/result`, { result: resultFor(job) })).status, 409);
  assert.equal(f.store.get('jobs', job.id).status, 'pending');
  assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 200); assert.ok(answerFor(f.store, 'q1'));
  assert.equal((await f.api('/api/v1/content/q1', {}, 'POST')).status, 404);
  for (const path of ['/api/state', '/api/backup', '/api/v1/snapshot', '/api/v1/content/q1']) assert.equal(JSON.stringify((await f.api(path)).data).includes(KEY), false);
});
