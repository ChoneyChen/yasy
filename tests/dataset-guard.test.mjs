import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { auditCorpus } from '../server/ai-workflow.mjs';
import { approvedConfidence } from './admission-fixture.mjs';

let vite, installDatasetGuard;
before(async () => {
  vite = await createViteServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ installDatasetGuard } = await vite.ssrLoadModule('/src/datasetGuard.ts'));
});
after(async () => { await vite?.close(); });

const bank = {
  sources: [{ id: 'epoch-source', title: 'Dataset guard fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-15', note: 'Automated test only.' }],
  topics: [{ id: 'epoch-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: 'Fixture', tags: ['learning'] }],
  questions: [{ id: 'q', scope: 'speaking', topicId: 'epoch-topic', sourceId: 'epoch-source', sourceType: 'adapted', part: 'Part 1', titleZh: '学习英语', promptEn: 'Do you enjoy learning English?', promptZh: '你喜欢学英语吗？', tags: ['learning'] }],
};
const textZh = '这是覆盖前 Mac 上保存的真实中文素材，需要在覆盖之前保留备份。';
const provider = { config: { public: () => ({ configured: true }), secret: () => ({ apiKey: 'fixture-capability', model: 'fixture-model' }), redact: value => String(value) } };
function memory(t) { const store = new Store({ file: ':memory:', bank }); t.after(() => store.close()); return store; }
async function fixture(t) {
  const store = memory(t);
  const server = createServer(createApp(store, {
    aiProvider: provider, recoverJobs: false,
    // This fixture isolates the application layer. MobileBridge's TLS and token
    // authentication are exercised by mobile.test.mjs before it sets this flag.
    requestGuard: req => { if (req.headers['x-fixture-ios'] === 'true') req.yasyClient = 'ios'; },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
    return { status: response.status, epoch: response.headers.get('X-Yasy-Dataset'), data: await response.json() };
  };
  return { store, server, base, api };
}
async function holdDraft(f, epoch, value) {
  const payload = JSON.stringify({ textZh: value, materialIds: [] });
  let seen;
  const received = new Promise(resolve => { seen = resolve; });
  const listener = req => { if (req.url === '/api/drafts/q' && req.method === 'PUT') { f.server.off('request', listener); seen(); } };
  f.server.on('request', listener);
  let upload;
  const response = new Promise((resolve, reject) => {
    upload = request(f.base + '/api/drafts/q', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Yasy-Dataset': epoch } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    upload.on('error', reject);
    upload.flushHeaders();
    upload.write(payload.slice(0, -1));
  });
  await received;
  return { finish: () => { upload.end(payload.slice(-1)); return response; } };
}

test('dataset identity survives normal edits and server restarts, changes only after a successful restore', t => {
  const directory = mkdtempSync(join(tmpdir(), 'yasy-dataset-'));
  const file = join(directory, 'learning.sqlite');
  let store;
  t.after(() => { store?.close(); rmSync(directory, { recursive: true, force: true }); });
  store = new Store({ file, bank });
  const first = store.datasetEpoch();
  store.saveDraft('q', { textZh, materialIds: [] });
  store.addWord({ textEn: 'original', scope: 'speaking' });
  assert.equal(store.datasetEpoch(), first);
  store.close();
  store = new Store({ file, bank });
  assert.equal(store.datasetEpoch(), first);
  const backup = store.backup();
  const invalid = structuredClone(backup);
  invalid.learning.drafts[0].questionId = 'unknown';
  assert.throws(() => store.restore(invalid));
  assert.equal(store.datasetEpoch(), first);
  store.restore(backup);
  const second = store.datasetEpoch();
  assert.notEqual(second, first);
  assert.equal(store.previousBackup().learning.drafts[0].textZh, textZh);
  store.close();
  store = new Store({ file, bank });
  assert.equal(store.datasetEpoch(), second);
});

test('phone overwrite invalidates old Mac autosaves and preserves a usable pre-overwrite snapshot', async t => {
  const f = await fixture(t), incoming = memory(t);
  await f.api('/api/drafts/q', { textZh, materialIds: [] }, 'PUT');
  await f.api('/api/words', { textEn: 'mac-before-overwrite', scope: 'speaking' });
  incoming.saveDraft('q', { textZh: '手机进度较新，这是用户明确选择保留的新素材。', materialIds: [] });
  incoming.addWord({ textEn: 'phone-progress', scope: 'speaking' });
  const before = await f.api('/api/state');
  const restored = await f.api('/api/backup', { backup: incoming.backup() }, 'POST', { 'X-Fixture-IOS': 'true' });
  assert.equal(restored.status, 200);
  assert.ok(restored.epoch && restored.epoch !== before.epoch);
  const stale = await f.api('/api/drafts/q', { textZh: '旧 Mac 页面的迟到自动保存，必须拒绝。', materialIds: [] }, 'PUT', { 'X-Yasy-Dataset': before.epoch });
  assert.equal(stale.status, 409);
  assert.equal(stale.epoch, restored.epoch);
  assert.equal(f.store.get('drafts', 'q').textZh, '手机进度较新，这是用户明确选择保留的新素材。');
  const previous = await f.api('/api/backup/previous');
  assert.equal(previous.status, 200);
  assert.equal(previous.data.learning.drafts[0].textZh, textZh);
  assert.equal(previous.data.learning.words[0].textEn, 'mac-before-overwrite');

  const recover = await f.api('/api/backup', { backup: previous.data }, 'POST', { 'X-Yasy-Dataset': restored.epoch });
  assert.equal(recover.status, 200);
  assert.notEqual(recover.epoch, restored.epoch);
  assert.equal(f.store.get('drafts', 'q').textZh, textZh);
  assert.equal(f.store.all('words')[0].textEn, 'mac-before-overwrite');
  assert.equal((await f.api('/api/drafts/q', { textZh: '刷新后的 Mac 页面可以继续写素材。', materialIds: [] }, 'PUT', { 'X-Yasy-Dataset': recover.epoch })).status, 200);
});

test('an old draft upload that began before sync cannot write after its last bytes arrive after overwrite', async t => {
  const f = await fixture(t), incoming = memory(t);
  const initial = await f.api('/api/state');
  const held = await holdDraft(f, initial.epoch, '覆盖开始前已经发出，但在覆盖结束后才上传完成的旧中文草稿。');
  incoming.saveDraft('q', { textZh: '这是本次手机同步选择的新进度。', materialIds: [] });
  const restored = await f.api('/api/backup', { backup: incoming.backup() }, 'POST', { 'X-Fixture-IOS': 'true' });
  assert.equal(restored.status, 200);
  const late = await held.finish();
  assert.equal(late.status, 409);
  assert.equal(f.store.get('drafts', 'q').textZh, '这是本次手机同步选择的新进度。');
});

test('syncing phone progress onto a Mac with a running answer or batch AI task returns 409 without overwriting', async t => {
  for (const table of ['jobs', 'batch_jobs']) await t.test(table, async t => {
    const f = await fixture(t), incoming = memory(t);
    f.store.addWord({ textEn: 'keep-active-mac', scope: 'speaking' });
    const firstEpoch = f.store.datasetEpoch();
    if (table === 'jobs') f.store.insert(table, { id: 'running-answer', questionId: 'q', scope: 'speaking', status: 'processing', createdAt: new Date().toISOString() });
    else f.store.insert(table, { id: 'running-batch', status: 'processing', filename: 'questions.pdf', scope: 'speaking', extension: 'pdf', prompt: 'Fixture extraction' });
    const response = await f.api('/api/backup', { backup: incoming.backup() }, 'POST', { 'X-Fixture-IOS': 'true' });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /AI.*处理/);
    assert.equal(f.store.datasetEpoch(), firstEpoch);
    assert.equal(f.store.all('words')[0].textEn, 'keep-active-mac');
    assert.equal(f.store.all(table)[0].status, 'processing');
    assert.equal(f.store.previousBackup(), undefined);
  });
});

test('a corpus audit started on the previous dataset cannot mutate matching records restored during its API call', async t => {
  const store = memory(t);
  const expression = { id: 'shared-expression', scope: 'speaking', textEn: 'build confidence', meaningZh: '建立信心', category: '情感态度', categoryEn: 'Emotions and attitudes', exampleEn: 'Practice can build confidence.', usageNote: '用于成长经历。', usageNoteEn: 'Use when describing personal growth.', tags: ['learning'], createdAt: new Date().toISOString(), admission: { policyVersion: 2, status: 'pending', reasonZh: '待审核', reasonEn: 'Pending review' } };
  store.insert('expressions', expression);
  let entered, complete;
  const started = new Promise(resolve => { entered = resolve; });
  const response = new Promise(resolve => { complete = resolve; });
  const operation = auditCorpus(store, { ...provider, request: async () => { entered(); return response; } }, { ids: [expression.id] });
  await started;
  const backup = store.backup();
  store.restore(backup);
  assert.deepEqual(store.get('expressions', expression.id), expression);
  complete({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reviews: [{ id: expression.id, admission: approvedConfidence }] }) } }] });
  await assert.rejects(operation, error => error.status === 409 && /覆盖|变更|更新/.test(error.message));
  assert.deepEqual(store.get('expressions', expression.id), expression);
});

test('the browser pins its first dataset for writes and reloads once when another device replaces it', async () => {
  const oldWindow = globalThis.window;
  const calls = [], reloads = [];
  const responses = ['dataset-a', 'dataset-b', 'dataset-b'];
  let reloadCount = 0;
  try {
    globalThis.window = {
      location: { href: 'http://127.0.0.1:4318/', origin: 'http://127.0.0.1:4318', reload: () => { reloadCount++; } },
      setTimeout: callback => { reloads.push(callback); return reloads.length; },
      fetch: async (input, options) => { calls.push({ input, options }); return new Response('{}', { headers: { 'X-Yasy-Dataset': responses.shift() } }); },
    };
    installDatasetGuard();
    await window.fetch('/api/state');
    await window.fetch('/api/state');
    const request = new Request('http://127.0.0.1:4318/api/drafts/q', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Fixture': 'preserved' }, body: JSON.stringify({ textZh: '旧草稿' }) });
    await window.fetch(request);
    assert.equal(calls[2].options.headers.get('X-Yasy-Dataset'), 'dataset-a');
    assert.equal(calls[2].options.headers.get('X-Fixture'), 'preserved');
    assert.equal(calls[2].input, request);
    assert.equal(reloads.length, 1);
    assert.equal(reloadCount, 0);
    reloads[0]();
    assert.equal(reloadCount, 1);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});

test('the browser does not send a local dataset header to external services or non-API assets', async () => {
  const oldWindow = globalThis.window;
  const calls = [], reloads = [];
  try {
    globalThis.window = {
      location: { href: 'http://127.0.0.1:4318/', origin: 'http://127.0.0.1:4318', reload: () => {} },
      setTimeout: callback => reloads.push(callback),
      fetch: async (input, options) => { calls.push({ input, options }); return new Response('{}', { headers: { 'X-Yasy-Dataset': String(input).startsWith('/api/') ? 'local-dataset' : 'unrelated' } }); },
    };
    installDatasetGuard();
    await window.fetch('/api/state');
    const external = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    await window.fetch('https://example.invalid/api/example', external);
    const asset = { method: 'GET' };
    await window.fetch('/assets/app.js', asset);
    assert.equal(calls[1].options, external);
    assert.equal(calls[2].options, asset);
    assert.equal(new Headers(calls[1].options.headers).has('X-Yasy-Dataset'), false);
    assert.equal(reloads.length, 0);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});
