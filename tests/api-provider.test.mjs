import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIConfig, IIIAPI_BASE_URL } from '../server/ai-config.mjs';
import { IIIAPIProvider } from '../server/iiiapi.mjs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// Deliberately fake, confined to a fresh temporary directory for each test.
// No test reads the real Mac's configuration or contacts iiiapi.
const SENTINEL = 'sk-yasy-sentinel-test-only-1234567890';
const MODEL = 'mock-dialogue-model';
const source = { id: 'api-source', title: 'Local API fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-13', note: 'Test fixture, not study data' };
const topic = { id: 'api-topic', scope: 'speaking', titleZh: '学习经历', titleEn: 'Learning experiences', description: 'Local test fixture', tags: ['learning'] };
const question = id => ({ id, topicId: topic.id, sourceId: source.id, scope: 'speaking', part: 'Part 1', sourceType: 'adapted', titleZh: '和朋友学习', promptEn: 'Do you enjoy learning English with friends?', promptZh: '你喜欢和朋友一起学英语吗？', tags: ['learning'] });
const bank = { sources: [source], topics: [topic], questions: [question('api-q1'), { ...question('api-q2'), promptEn: 'Do you enjoy sharing your experiences?' }] };
const draftZh = '我喜欢和朋友一起学英语，因为我们可以分享真实的经历。上周我们在学校一起练习口语，朋友的鼓励让我敢于表达自己的想法，也帮助我建立了信心。';
const prose = 'I enjoy learning English with friends because their encouragement helps me build confidence. Last week, we met at school and shared our real experiences. I felt more comfortable explaining my ideas.';
function output(job, extra = {}) {
  return {
    requestId: job.id, questionId: job.questionId, scope: job.scope,
    quality: { passed: true, suggestions: [] },
    answer: { textEn: prose, outlineZh: '直接回答—具体经历—感受', materialSpans: [{ quote: prose, materialIndex: 0 }] },
    materials: [{ title: 'Learning with friends', summaryZh: '和朋友练习英语让我更自信', detailZh: draftZh, summaryEn: 'Learning with friends helped me become more confident.', detailEn: prose, tags: ['learning'] }],
    expressions: [{ textEn: 'build confidence', meaningZh: '建立信心', category: '成长', categoryEn: 'Personal growth', exampleEn: 'Their encouragement helps me build confidence.', usageNote: '用于描述逐步获得信心。', usageNoteEn: 'Use this collocation to describe becoming more confident.', tags: ['learning'], materialIndexes: [0] }],
    recommendations: [], ...extra,
  };
}
const completion = (payload, extra = {}) => ({ model: MODEL, choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 88, total_tokens: 211 }, ...extra });
const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const noSecret = value => assert.equal(JSON.stringify(value).includes(SENTINEL), false, 'the private authentication key must not appear in a client-visible response');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!server?.listening) return; server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }

async function fixture(t, { timeoutMs = 1000, modelTimeoutMs = 1000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'yasy-api-provider-'));
  const file = join(dir, 'learning.sqlite');
  const config = new AIConfig({ file: join(dir, 'sentinel-secrets.json') });
  config.update({ apiKey: SENTINEL, model: MODEL });
  let store = new Store({ file, bank });
  store.setSettings({ provider: 'iiiapi' });
  let handler;
  const calls = [];
  const timers = new Set();
  const schedule = (callback, milliseconds) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, milliseconds); timers.add(timer); return timer; };
  const mock = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      const call = { path: req.url, method: req.method, authorization: req.headers.authorization, body };
      calls.push(call);
      if (handler) { await handler({ req, res, body, call, store, schedule }); return; }
      if (req.url === '/v1/models') { send(res, { data: [{ id: MODEL, owned_by: 'test-fixture' }] }); return; }
      const job = store.all('jobs').find(job => job.prompt === body?.messages?.[1]?.content);
      assert.ok(job, 'the network request must carry the persisted job prompt');
      send(res, completion(output(job)));
    } catch (error) {
      if (!res.headersSent) send(res, { error: { message: 'Mock fixture failed' } }, 500);
      else res.destroy();
    }
  });
  const mockBase = await listen(mock);
  const provider = new IIIAPIProvider({ config, baseUrl: `${mockBase}/v1`, timeoutMs, modelTimeoutMs });
  let server = createServer(createApp(store, { aiProvider: provider }));
  let base = await listen(server);
  t.after(async () => { await close(server); await close(mock); for (const timer of timers) clearTimeout(timer); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, data: await response.json() };
  };
  return {
    dir, config, provider, calls, api, get store() { return store; },
    setHandler(next) { handler = next; },
    async job(questionId = 'api-q1') { const response = await api('/api/jobs', { questionId, textZh: draftZh, materialIds: [] }); assert.equal(response.status, 200); return response.data.job; },
    async restart(nextBank = bank) { await close(server); store.close(); store = new Store({ file, bank: nextBank }); server = createServer(createApp(store, { aiProvider: provider })); base = await listen(server); },
  };
}
async function clientSurfaces(f) {
  for (const path of ['/api/ai/config', '/api/state', '/api/backup', '/api/v1/snapshot']) { const response = await f.api(path); assert.equal(response.status, 200); noSecret(response.data); }
}

test('API credentials stay write-only while real model IDs and Bearer headers cross the provider boundary', async t => {
  const f = await fixture(t);
  f.setHandler(({ req, res, body, store }) => {
    if (req.url === '/v1/models') return send(res, { data: [{ id: 'zeta' }, { id: MODEL }, { id: MODEL }, null, {}, { id: SENTINEL }, { id: 'safe-owner', owned_by: `owner-${SENTINEL}` }, { id: 'x'.repeat(201) }] });
    const job = store.all('jobs').find(job => job.prompt === body.messages[1].content);
    send(res, completion(output(job), { model: `vendor-${SENTINEL}`, usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, vendor_debug: SENTINEL } }));
  });
  const saved = await f.api('/api/ai/config', { provider: 'iiiapi', apiKey: SENTINEL, model: MODEL }, 'PATCH');
  assert.equal(saved.status, 200); assert.equal(saved.data.hasKey, true); assert.equal(saved.data.configured, true); assert.equal(saved.data.baseUrl, IIIAPI_BASE_URL); noSecret(saved.data);
  assert.equal(statSync(f.config.file).mode & 0o777, 0o600);
  const models = await f.api('/api/ai/models');
  assert.equal(models.status, 200); assert.deepEqual(models.data.models.map(model => model.id), [MODEL, 'safe-owner', 'zeta']); assert.equal(models.data.selectedModel, MODEL); noSecret(models.data);
  const before = f.calls.filter(call => call.path === '/v1/chat/completions').length;
  const checked = await f.api('/api/ai/test', {});
  assert.equal(checked.status, 200); assert.equal(checked.data.ok, true); noSecret(checked.data);
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, before, 'connection checks must not purchase a completion');
  const rejectedHost = await f.api('/api/ai/config', { baseUrl: 'http://untrusted.invalid/v1' }, 'PATCH');
  assert.equal(rejectedHost.status, 400); noSecret(rejectedHost.data);
  const job = await f.job();
  const generated = await f.api(`/api/jobs/${job.id}/generate`, {});
  assert.equal(generated.status, 200); assert.equal(generated.data.job.status, 'completed'); assert.equal(generated.data.state.answers.length, 1); noSecret(generated.data);
  const request = f.calls.find(call => call.path === '/v1/chat/completions');
  assert.equal(request.authorization, `Bearer ${SENTINEL}`); assert.equal(request.body.model, MODEL); assert.equal(request.body.stream, false);
  assert.equal(request.body.messages[1].content, job.prompt); assert.equal(request.body.messages[0].role, 'system');
  assert.ok(f.calls.every(call => call.authorization === `Bearer ${SENTINEL}`));
  assert.deepEqual(generated.data.job.usage, { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 });
  assert.equal(generated.data.job.model, 'vendor-[redacted]');
  await clientSurfaces(f);
});

test('upstream key echoes are redacted; failed tasks retain existing learning data and can be retried', async t => {
  const f = await fixture(t);
  const first = await f.job(); assert.equal((await f.api(`/api/jobs/${first.id}/generate`, {})).status, 200);
  const savedAnswer = structuredClone(f.store.all('answers')[0]);
  const savedMaterials = structuredClone(f.store.all('materials'));
  const second = await f.job();
  f.setHandler(({ res }) => send(res, { error: { message: `Invalid credential ${SENTINEL}` } }, 401));
  const failed = await f.api(`/api/jobs/${second.id}/generate`, {});
  assert.equal(failed.status, 502); assert.match(failed.data.error, /\[redacted\]/); noSecret(failed.data);
  assert.equal(f.store.get('jobs', second.id).status, 'failed'); assert.deepEqual(f.store.all('answers'), [savedAnswer]); assert.deepEqual(f.store.all('materials'), savedMaterials);
  await clientSurfaces(f);
  f.setHandler(undefined);
  const retried = await f.api(`/api/jobs/${second.id}/generate`, {});
  assert.equal(retried.status, 200); assert.equal(retried.data.job.status, 'completed'); assert.equal(f.store.all('answers').length, 1); assert.equal(f.store.all('answers')[0].id, savedAnswer.id); assert.equal(f.store.all('revisions').length, 1);
});

test('rotating credentials during a request never exposes the credential that actually authenticated that request', async t => {
  const oldKey = 'yasy-old-fixture-credential-12345';
  const newKey = 'yasy-new-fixture-credential-67890';
  for (const kind of ['gateway-error', 'model-list', 'answer-content']) await t.test(kind, async inner => {
    const f = await fixture(inner); f.config.update({ apiKey: oldKey });
    const job = kind === 'answer-content' ? await f.job() : null;
    const entered = deferred(); const release = deferred();
    f.setHandler(async ({ res }) => {
      entered.resolve(); await release.promise;
      if (kind === 'gateway-error') send(res, { error: { message: `Rejected credential ${oldKey}` } }, 401);
      else if (kind === 'model-list') send(res, { data: [{ id: oldKey }, { id: MODEL, owned_by: oldKey }] });
      else { const result = output(job); result.materials[0].detailEn += oldKey; send(res, completion(result)); }
    });
    const pending = kind === 'answer-content' ? f.api(`/api/jobs/${job.id}/generate`, {}) : f.api('/api/ai/models');
    await entered.promise; f.config.update({ apiKey: newKey }); release.resolve();
    const response = await pending;
    assert.equal(JSON.stringify(response.data).includes(oldKey), false);
    assert.equal(JSON.stringify(response.data).includes(newKey), false);
    assert.equal(f.calls[0].authorization, `Bearer ${oldKey}`);
    if (kind === 'model-list') { assert.equal(response.status, 200); assert.deepEqual(response.data.models.map(m => m.id), [MODEL]); }
    else assert.equal(response.status, 502);
    assert.equal(f.store.all('answers').length, 0);
  });
});

test('malformed model lists and non-JSON gateway responses fail clearly without exposing body contents', async t => {
  for (const scenario of [
    { name: 'wrong model-list shape', response: res => send(res, { models: [{ id: MODEL }] }) },
    { name: 'non-JSON gateway body', response: res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<html>${SENTINEL}</html>`); } },
  ]) await t.test(scenario.name, async inner => {
    const f = await fixture(inner); f.setHandler(({ res }) => scenario.response(res));
    const result = await f.api('/api/ai/models'); assert.equal(result.status, 502); assert.ok(result.data.error); noSecret(result.data);
    assert.equal(f.store.all('answers').length, 0); await clientSurfaces(f);
  });
});

test('incomplete, malformed or credential-bearing completions never become saved study content', async t => {
  const scenarios = [
    { name: 'missing choices', response: () => ({ model: MODEL, choices: [] }), status: 502 },
    { name: 'truncated generation', response: job => completion(output(job), { choices: [{ message: { content: JSON.stringify(output(job)) }, finish_reason: 'length' }] }), status: 502 },
    { name: 'assistant text is not JSON', response: () => ({ choices: [{ message: { content: 'Here is your answer, without the requested JSON.' }, finish_reason: 'stop' }] }), status: 400 },
    { name: 'English answer has wrong value type', response: job => { const value = output(job); value.answer.textEn = 42; return completion(value); }, status: 400 },
    { name: 'credentials inside answer content', response: job => { const value = output(job); value.materials[0].detailEn += SENTINEL; return completion(value); }, status: 502 },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async inner => {
    const f = await fixture(inner); const job = await f.job(); f.setHandler(({ res }) => send(res, scenario.response(job)));
    const failed = await f.api(`/api/jobs/${job.id}/generate`, {}); assert.equal(failed.status, scenario.status); noSecret(failed.data);
    assert.equal(f.store.get('jobs', job.id).status, 'failed'); assert.equal(f.store.all('answers').length, 0); assert.equal(f.store.all('materials').length, 0); assert.equal(f.store.all('expressions').length, 0); await clientSurfaces(f);
  });
});

test('AI quality rejection returns actionable suggestions rather than writing an answer', async t => {
  const f = await fixture(t); const job = await f.job();
  f.setHandler(({ res }) => send(res, completion({ requestId: job.id, questionId: job.questionId, scope: job.scope, quality: { passed: false, suggestions: ['补充一次具体练习的经过与感受。'] } })));
  const rejected = await f.api(`/api/jobs/${job.id}/generate`, {});
  assert.equal(rejected.status, 422); assert.equal(rejected.data.quality.passed, false); assert.ok(rejected.data.quality.suggestions[0]);
  assert.equal(f.store.get('jobs', job.id).status, 'needs-revision'); assert.equal(f.store.all('answers').length, 0); assert.equal(f.store.all('materials').length, 0); noSecret(rejected.data);
  assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 409, 'a rejected draft requires a new task after revision');
});

test('timeouts cover both response headers and a stalled body, including model discovery', async t => {
  for (const scenario of ['headers', 'completion body', 'model body']) await t.test(scenario, async inner => {
    const f = await fixture(inner, { timeoutMs: 80, modelTimeoutMs: 80 });
    const job = scenario === 'model body' ? null : await f.job();
    f.setHandler(({ res, schedule }) => {
      if (scenario === 'headers') { schedule(() => { if (!res.destroyed) send(res, completion(output(job))); }, 400); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"delayed":');
      schedule(() => { if (!res.destroyed) res.end('true}'); }, 400);
    });
    const timedOut = await f.api(job ? `/api/jobs/${job.id}/generate` : '/api/ai/models', job ? {} : undefined);
    assert.equal(timedOut.status, 504); assert.match(timedOut.data.error, /超时/); noSecret(timedOut.data);
    assert.equal(f.store.all('answers').length, 0); assert.equal(f.store.all('materials').length, 0);
    if (job) assert.equal(f.store.get('jobs', job.id).status, 'failed');
    await clientSurfaces(f);
  });
});

test('concurrent submissions buy one completion and import a task exactly once', async t => {
  const f = await fixture(t); const job = await f.job(); const entered = deferred(); const release = deferred();
  f.setHandler(async ({ res }) => { entered.resolve(); await release.promise; send(res, completion(output(job))); });
  const first = f.api(`/api/jobs/${job.id}/generate`, {}); await entered.promise;
  const duplicate = await f.api(`/api/jobs/${job.id}/generate`, {});
  assert.equal(duplicate.status, 409); assert.equal(f.store.get('jobs', job.id).status, 'processing'); assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 1);
  release.resolve(); assert.equal((await first).status, 200);
  assert.equal(f.store.all('answers').length, 1); assert.equal(f.store.all('materials').length, 1); assert.equal(f.store.all('expressions').length, 1); assert.equal(f.store.all('revisions').length, 0);
  assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 409); assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 1);
});

test('stale drafts are rejected before a paid dispatch and late responses preserve the latest saved answer', async t => {
  const f = await fixture(t); const stale = await f.job();
  assert.equal((await f.api(`/api/drafts/${stale.questionId}`, { textZh: draftZh + '后来我又补充了练习的地点。', materialIds: [] }, 'PUT')).status, 200);
  const prevented = await f.api(`/api/jobs/${stale.id}/generate`, {});
  assert.equal(prevented.status, 409); assert.equal(f.calls.length, 0); assert.equal(f.store.all('answers').length, 0);
  const baseline = await f.job(); assert.equal((await f.api(`/api/jobs/${baseline.id}/generate`, {})).status, 200);
  const saved = structuredClone(f.store.all('answers')[0]); const materials = structuredClone(f.store.all('materials'));
  const late = await f.job(); const entered = deferred(); const release = deferred();
  f.setHandler(async ({ res }) => { entered.resolve(); await release.promise; send(res, completion(output(late))); });
  const running = f.api(`/api/jobs/${late.id}/generate`, {}); await entered.promise;
  assert.equal((await f.api(`/api/drafts/${late.questionId}`, { textZh: draftZh + '我已经修改了具体经历。', materialIds: [] }, 'PUT')).status, 200);
  release.resolve(); const rejected = await running;
  assert.equal(rejected.status, 409); assert.deepEqual(f.store.all('answers'), [saved]); assert.deepEqual(f.store.all('materials'), materials); assert.equal(f.store.get('jobs', late.id).status, 'failed'); assert.equal(f.store.all('revisions').length, 0);
});

test('a superseded in-flight task cannot overwrite a later manually imported answer', async t => {
  const f = await fixture(t); const older = await f.job(); const entered = deferred(); const release = deferred();
  f.setHandler(async ({ res }) => { entered.resolve(); await release.promise; send(res, completion(output(older))); });
  const running = f.api(`/api/jobs/${older.id}/generate`, {}); await entered.promise;
  const newer = await f.job(); const manuallySaved = await f.api(`/api/jobs/${newer.id}/result`, { result: output(newer) }); assert.equal(manuallySaved.status, 200);
  const current = structuredClone(f.store.all('answers')[0]); release.resolve();
  assert.equal((await running).status, 409); assert.deepEqual(f.store.all('answers'), [current]); assert.equal(current.jobId, newer.id); assert.equal(f.store.get('jobs', older.id).status, 'needs-revision'); assert.equal(f.store.all('revisions').length, 0);
});

test('server restart exposes interrupted work as retryable failure without fabricating an answer', async t => {
  const f = await fixture(t); const job = await f.job();
  f.store.insert('jobs', { ...job, status: 'processing', runId: 'interrupted-run', startedAt: '2020-01-01T00:00:00.000Z' });
  await f.restart();
  const restarted = f.store.get('jobs', job.id); assert.equal(restarted.status, 'failed'); assert.match(restarted.error, /重启/); assert.equal(f.calls.length, 0); assert.equal(f.store.all('answers').length, 0);
  const recovered = await f.api(`/api/jobs/${job.id}/generate`, {}); assert.equal(recovered.status, 200); assert.equal(recovered.data.job.status, 'completed'); assert.equal(f.store.all('answers').length, 1); await clientSurfaces(f);
});

test('PDF bank replacement archives once, retains learning, and does not erase later imports on restart', async t => {
  const f = await fixture(t); const job = await f.job(); assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 200);
  const answer = structuredClone(f.store.all('answers')[0]); const materials = structuredClone(f.store.all('materials')); const expressions = structuredClone(f.store.all('expressions'));
  f.store.addWord({ textEn: 'confidence', meaningZh: '信心', scope: 'speaking', questionId: 'api-q1' });
  assert.equal((await f.api('/api/reviews', { kind: 'answer', id: answer.id })).status, 200);
  const reviews = structuredClone(f.store.all('review_states'));
  const replacement = { ...bank, replaceExisting: true, generation: 'fixture-pdf-v1', questions: [{ ...question('pdf-active-question'), promptEn: 'Do you enjoy meeting new people?' }] };
  f.store.seed(replacement);
  const migrated = (await f.api('/api/state')).data;
  assert.deepEqual(migrated.questions.map(q => q.id), ['pdf-active-question']); assert.ok(migrated.archivedQuestions.some(q => q.id === 'api-q1'));
  assert.deepEqual(migrated.answers, [answer]); assert.deepEqual(migrated.materials, materials); assert.deepEqual(migrated.expressions, expressions); assert.equal(migrated.words.length, 1); assert.deepEqual(f.store.all('review_states'), reviews);
  assert.equal((await f.api('/api/v1/content/api-q1')).status, 200);
  assert.equal((await f.api('/api/questions/api-q1/recommendations')).status, 200);
  assert.equal((await f.api('/api/drafts/api-q1', { textZh: draftZh, materialIds: [] }, 'PUT')).status, 409);
  assert.equal((await f.api('/api/jobs', { questionId: 'api-q1', textZh: draftZh, materialIds: [] })).status, 409);
  assert.equal((await f.api('/api/plan', { questionIds: ['api-q1'] }, 'PUT')).status, 409);
  const upload = await f.api('/api/batches', { filename: 'later-import.pdf', scope: 'speaking', fileBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') }); assert.equal(upload.status, 200);
  const candidate = { scope: 'speaking', topicZh: '每日练习', topicEn: 'Daily practice', titleZh: '日常练习的时间', promptEn: 'When do you practise English every day?', promptZh: '你每天什么时候练习英语？', part: 'Part 1', taskType: '', cuePoints: [], tags: ['learning'], sourceNote: 'User fixture page 1', sourceType: 'reported', visual: null };
  const preview = await f.api(`/api/batches/${upload.data.job.id}/preview`, { result: { requestId: upload.data.job.id, questions: [candidate] } }); assert.equal(preview.status, 200);
  const committed = await f.api(`/api/batches/${upload.data.job.id}/commit`, { selectedKeys: [preview.data.candidates[0].key] }); assert.equal(committed.status, 200); assert.equal(committed.data.imported, 1);
  const imported = committed.data.state.questions.find(q => q.promptEn === candidate.promptEn); assert.ok(imported);
  await f.restart(replacement);
  const firstRestart = f.store.state(); assert.ok(firstRestart.questions.some(q => q.id === imported.id)); assert.deepEqual(firstRestart.answers, [answer]); assert.deepEqual(firstRestart.materials, materials); assert.deepEqual(f.store.all('review_states'), reviews); assert.equal(firstRestart.words.length, 1);
  await f.restart(replacement);
  const secondRestart = f.store.state(); assert.ok(secondRestart.questions.some(q => q.id === imported.id)); assert.equal(secondRestart.archivedQuestions.filter(q => q.id === 'api-q1').length, 1); assert.deepEqual(secondRestart.answers, [answer]); assert.equal(f.store.all('revisions').length, 0);
  await clientSurfaces(f);
});

test('an explicitly restored older bank remains exact across restarts until a new published generation is installed', async t => {
  const f = await fixture(t); const job = await f.job();
  assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 200);
  const older = f.store.backup();
  const published = { ...bank, replaceExisting: true, generation: 'published-v1', questions: [question('new-pdf-question')] };
  await f.restart(published);
  assert.deepEqual(f.store.state().questions.map(q => q.id), ['new-pdf-question']);
  const restored = await f.api('/api/backup', { backup: older }); assert.equal(restored.status, 200);
  for (let i = 0; i < 2; i++) {
    await f.restart(published);
    assert.deepEqual(f.store.all('questions'), older.bank.questions);
    assert.deepEqual(f.store.all('answers'), older.learning.answers);
    assert.equal(f.store.state().archivedQuestions.length, 0);
  }
  await f.restart({ ...published, generation: 'published-v2' });
  assert.deepEqual(f.store.state().questions.map(q => q.id), ['new-pdf-question']);
  assert.equal(f.store.state().archivedQuestions.length, 2);
  assert.deepEqual(f.store.all('answers'), older.learning.answers);
});

test('restoring an unfinished API job makes it immediately retryable without an orphaned processing state', async t => {
  const f = await fixture(t); const job = await f.job();
  f.store.insert('jobs', { ...job, status: 'processing', runId: 'orphaned-fixture-run' });
  const restored = await f.api('/api/backup', { backup: f.store.backup() });
  assert.equal(restored.status, 200); assert.equal(restored.data.state.jobs[0].status, 'failed');
  assert.match(restored.data.state.jobs[0].error, /备份/); assert.equal(f.calls.length, 0);
  assert.equal((await f.api(`/api/jobs/${job.id}/generate`, {})).status, 200);
  assert.equal(f.store.all('answers').length, 1);
});

test('API processing retains the full expression corpus while limiting each material to three links', async t => {
  const f = await fixture(t);
  const phrases = ['I enjoy learning English', 'learning English with friends', 'encouragement', 'build confidence', 'our real experiences', 'explaining my ideas'];
  f.setHandler(({ res, body, store }) => {
    const job = store.all('jobs').find(job => job.prompt === body.messages[1].content);
    const result = output(job);
    result.expressions = phrases.map(textEn => ({ ...result.expressions[0], textEn }));
    send(res, completion(result));
  });
  const job = await f.job(); const generated = await f.api(`/api/jobs/${job.id}/generate`, {});
  assert.equal(generated.status, 200); assert.equal(generated.data.state.expressions.length, 6);
  assert.equal(generated.data.state.links.filter(l => l.kind === 'material-expression').length, 3);
  assert.equal(generated.data.state.answers[0].expressionIds.length, 6);
});

test('same-opening Part 2 candidates carry distinct cue points into the recommendation prompt', async t => {
  const f = await fixture(t);
  const opening = 'Describe a person who helped you.';
  const cards = ['at school', 'during a difficult journey'].map((cue, index) => ({ ...question(`cue-card-${index}`), part: 'Part 2', promptEn: opening, cuePoints: ['Who the person is', `How they helped you ${cue}`, 'When this happened', 'How you felt'] }));
  await f.restart({ ...bank, questions: [...bank.questions, ...cards] });
  const job = await f.job();
  assert.ok(job.prompt.includes('How they helped you at school'));
  assert.ok(job.prompt.includes('How they helped you during a difficult journey'));
  assert.ok(job.candidateIds.includes('cue-card-0') && job.candidateIds.includes('cue-card-1'));
});
