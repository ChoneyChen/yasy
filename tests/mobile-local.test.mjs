import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { approvedSharing } from './admission-fixture.mjs';

let vite, createLocalStore, createLocalRouter;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ createLocalStore } = await vite.ssrLoadModule('/src/mobileLocal/store.mjs'));
  ({ createLocalRouter } = await vite.ssrLoadModule('/src/mobileLocal/router.mjs'));
});
after(async () => { await vite?.close(); });

const bank = {
  sources: [{ id: 'local-source', title: 'Independent phone fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-15', note: 'Automated test only.' }],
  topics: [{ id: 'local-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: 'Fixture', tags: ['learning'] }],
  questions: ['q1', 'q2'].map(id => ({ id, scope: 'speaking', topicId: 'local-topic', sourceId: 'local-source', sourceType: 'adapted', part: 'Part 1', titleZh: '学习经历', promptEn: id === 'q1' ? 'Do you enjoy learning English?' : 'Do you prefer learning with friends?', promptZh: '你喜欢如何学习？', tags: ['learning'] })),
};
const chinese = '我喜欢和朋友一起学英语，因为我们可以分享各自真实的经历。我会先写下中文素材，再用英语把这个故事清楚地讲出来。上周我分享了一次旅行，他们帮我补充了细节，我觉得这种练习很有收获。';
const answer = 'Yes, I enjoy learning English with my friends because we can share our experiences and help each other express our ideas clearly. Last week, I described a family trip, and their questions helped me notice which details were missing. That kind of practice makes me feel much more confident.';
function result(job) {
  return {
    requestId: job.id, questionId: job.questionId, scope: job.scope,
    quality: { passed: true, suggestions: [] },
    answer: { textEn: answer, outlineZh: '直接回答，再用真实经历说明原因。', materialSpans: [{ quote: answer, materialIndex: 0 }] },
    materials: [{ title: 'Practising English with friends', summaryZh: '与朋友分享旅行经历来练习英语', detailZh: chinese, summaryEn: 'Practising English by sharing real experiences with friends.', detailEn: 'Last week, my friends and I practised English by discussing a family trip. Their questions helped me add useful details.', tags: ['learning'] }],
    expressions: [{ textEn: 'share our experiences', meaningZh: '分享我们的经历', category: '口语搭配', categoryEn: 'Spoken collocation', exampleEn: 'We can share our experiences.', usageNote: '描述交流真实经历。', usageNoteEn: 'Use when discussing experiences with other people.', tags: ['learning'], materialIndexes: [0], admission: approvedSharing }],
    recommendations: [{ materialIndex: 0, questionId: job.questionId === 'q1' ? 'q2' : 'q1', score: 0.9, reason: '同样涉及和朋友学习的经历。' }],
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeProvider(overrides = {}) {
  return {
    config: { public: () => ({ configured: true }), secret: () => ({ model: 'fixture-model', apiKey: 'fixture-capability' }), redact: value => String(value) },
    generate: async job => ({ result: result(job), model: 'fixture-model' }),
    request: async () => { throw new Error('Unexpected model request'); },
    ...overrides,
  };
}
function persistence(initial = null) {
  return {
    current: initial && structuredClone(initial), previous: null, saves: [], fail: false,
    async load() { return this.current && structuredClone(this.current); },
    async save(value, restoring) {
      if (this.fail) throw new Error('Fixture disk is full');
      if (restoring) this.previous = this.current && structuredClone(this.current);
      this.current = structuredClone(value);
      this.saves.push({ restoring, value: structuredClone(value) });
    },
  };
}
async function fixture(t, { saved = persistence(), provider = fakeProvider(), call = async action => { throw new Error(`Unexpected native call: ${action}`); }, seed = bank } = {}) {
  const runtime = await createLocalStore({ ...(seed === null ? {} : { bank: seed }), load: () => saved.load(), save: (value, restoring) => saved.save(value, restoring) });
  t.after(() => runtime.store.close());
  const route = await createLocalRouter({ runtime, call, providerFactory: async () => provider });
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await route(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  return { runtime, store: runtime.store, route, api, saved };
}
async function newJob(api, questionId = 'q1') {
  const response = await api('/api/jobs', { questionId, textZh: chinese, materialIds: [] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.job;
}
async function settleJob(store, id) {
  // Observe a real async completion rather than assuming a fixed model latency.
  for (let attempt = 0; attempt < 100 && store.get('jobs', id)?.status === 'processing'; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  return store.get('jobs', id);
}

test('the iPhone opens its real 743-question bank and practice mode without Mac, pairing or network', async t => {
  const originalFetch = globalThis.fetch;
  let requests = 0, nativeCalls = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No network is available'); };
  try {
    const { api } = await fixture(t, { seed: null, call: async () => { nativeCalls++; throw new Error('Mac is not paired'); } });
    const state = await api('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.data.questions.length, 743);
    assert.equal(state.data.settings.examType, 'academic');
    assert.equal(state.data.settings.targetBand, '7.0');
    assert.equal(state.data.settings.provider, 'iiiapi');
    assert.equal(state.data.storage.kind, 'iPhone 本地');
    for (const kind of ['speaking', 'writing']) {
      const next = await api(`/api/practice/next?kind=${kind}&mode=first`);
      assert.equal(next.status, 200);
      assert.equal(next.data.reason, 'ready');
      assert.ok(next.data.question.id);
    }
    assert.equal(requests, 0);
    assert.equal(nativeCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('Chinese drafts, word meanings and spaced review history survive a full phone-store restart', async t => {
  const saved = persistence();
  const first = await fixture(t, { saved });
  assert.equal((await first.api('/api/drafts/q1', { textZh: chinese, materialIds: [] }, 'PUT')).status, 200);
  const word = await first.api('/api/words', { textEn: 'confidence', meaningZh: '信心', exampleEn: 'Practice builds confidence.', scope: 'speaking' });
  assert.equal(word.status, 200);
  const reviewed = await first.api('/api/reviews', { kind: 'word', id: word.data.id });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.reviewCount, 1);
  assert.equal(reviewed.data.intervalDays, 1);

  const second = await fixture(t, { saved });
  assert.equal(second.store.get('drafts', 'q1').textZh, chinese);
  assert.equal(second.store.all('words')[0].meaningZh, '信心');
  assert.equal(second.store.all('review_states')[0].reviewCount, 1);
  assert.equal(second.store.all('review_events').length, 1);
  const queue = await second.api('/api/reviews?kind=words');
  assert.equal(queue.data.total, 1);
  assert.equal(queue.data.item, null);
  assert.equal(queue.data.nextDueAt, reviewed.data.dueAt);
});

test('a failed native save rolls SQLite back and does not poison the next write', async t => {
  const { saved, api, store } = await fixture(t);
  await api('/api/drafts/q1', { textZh: chinese, materialIds: [] }, 'PUT');
  const committed = structuredClone(saved.current);
  saved.fail = true;
  const failedDraft = await api('/api/drafts/q1', { textZh: '这次写入必须完整回滚，不能替换原先保存的素材。', materialIds: [] }, 'PUT');
  const failedWord = await api('/api/words', { textEn: 'uncommitted', scope: 'speaking' });
  assert.equal(failedDraft.status, 500);
  assert.equal(failedWord.status, 500);
  assert.equal(store.get('drafts', 'q1').textZh, chinese);
  assert.equal(store.all('words').length, 0);
  assert.deepEqual(saved.current, committed);
  saved.fail = false;
  assert.equal((await api('/api/words', { textEn: 'recovered', scope: 'speaking' })).status, 200);
  assert.equal(store.all('words')[0].textEn, 'recovered');
});

test('one background AI call leaves other questions writable and persists the completed annotated answer', async t => {
  const modelReply = deferred(), entered = deferred();
  let calls = 0;
  const provider = fakeProvider({ generate: async job => { calls++; entered.resolve(job); return modelReply.promise; } });
  const { api, store, saved } = await fixture(t, { provider });
  const job = await newJob(api);
  const accepted = await api(`/api/jobs/${job.id}/generate`, { background: true });
  assert.equal(accepted.status, 202);
  await entered.promise;
  const other = await api('/api/drafts/q2', { textZh: '我正在写另一道题的中文素材，上一题仍在整理。', materialIds: [] }, 'PUT');
  assert.equal(other.status, 200);
  assert.equal(store.get('jobs', job.id).status, 'processing');
  assert.equal((await api('/api/sync', { direction: 'push', confirmed: true })).status, 409);
  modelReply.resolve({ result: result(job), model: 'fixture-model', usage: { total_tokens: 10 } });
  assert.equal((await settleJob(store, job.id)).status, 'completed');
  assert.equal(calls, 1);
  assert.equal(store.all('answers')[0].textEn, answer);
  assert.equal(store.all('answers')[0].materialSpans.length, 1);
  assert.equal(store.all('materials')[0].summaryZh, '与朋友分享旅行经历来练习英语');
  assert.ok(store.all('materials')[0].summaryEn);
  assert.equal(store.all('expressions')[0].admission.status, 'approved');
  assert.equal(store.recommendations('q2').materials.length, 1);
  assert.equal(store.get('drafts', 'q2').textZh, other.data.textZh);
  const restarted = await fixture(t, { saved });
  assert.equal(restarted.store.all('answers')[0].textEn, answer);
  assert.equal(restarted.store.all('expressions')[0].textEn, 'share our experiences');
  assert.equal(restarted.store.get('drafts', 'q2').textZh, other.data.textZh);
});

test('changing a Chinese draft while a model is working rejects its stale result without a second model call', async t => {
  const reply = deferred();
  let calls = 0;
  const { api, store } = await fixture(t, { provider: fakeProvider({ generate: async () => { calls++; return reply.promise; } }) });
  const job = await newJob(api);
  assert.equal((await api(`/api/jobs/${job.id}/generate`, { background: true })).status, 202);
  const changed = chinese + '我更正了当时旅行的细节。';
  await api('/api/drafts/q1', { textZh: changed, materialIds: [] }, 'PUT');
  reply.resolve({ result: result(job), model: 'fixture-model' });
  assert.equal((await settleJob(store, job.id)).status, 'failed');
  assert.match(store.get('jobs', job.id).error, /已变更/);
  assert.equal(store.get('drafts', 'q1').textZh, changed);
  assert.equal(store.all('answers').length, 0);
  assert.equal(store.all('materials').length, 0);
  assert.equal(calls, 1);
});

test('a stale pending phone job is rejected before spending a model call', async t => {
  let calls = 0;
  const { api, store } = await fixture(t, { provider: fakeProvider({ generate: async job => { calls++; return { result: result(job), model: 'fixture-model' }; } }) });
  const job = await newJob(api);
  const changed = chinese + '这份素材在点击整理之前已经改过。';
  await api('/api/drafts/q1', { textZh: changed, materialIds: [] }, 'PUT');
  const response = await api(`/api/jobs/${job.id}/generate`, { background: true });
  assert.equal(response.status, 409);
  assert.equal(calls, 0);
  assert.equal(store.get('drafts', 'q1').textZh, changed);
  assert.equal(store.all('answers').length, 0);
});

test('idea help is an independent Chinese-only preview call and does not create or replace an answer or draft', async t => {
  let ideaCalls = 0, formalCalls = 0;
  const { api, store } = await fixture(t, { provider: fakeProvider({
    generate: async () => { formalCalls++; throw new Error('Idea help must not start answer generation'); },
    request: async (path, { body }) => {
      assert.equal(path, '/chat/completions');
      assert.equal(body.max_tokens, 4096);
      const origin = ideaCalls++ === 0 ? 'generated' : 'refined';
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questionId: 'q1', origin, requiresConfirmation: true, draftZh: '可以从一次和朋友练英语的经历展开，先交代活动，再写遇到的困难和自己的感受。', notes: ['请按真实经历修改。'] }) } }] };
    },
  }) });
  for (const textZh of ['', chinese]) {
    const idea = await api('/api/ideas', { questionId: 'q1', textZh });
    assert.equal(idea.status, 200);
    assert.equal(idea.data.requiresConfirmation, true);
    assert.match(idea.data.draftZh, /中文|经历/);
    assert.equal(idea.data.origin, textZh ? 'refined' : 'generated');
  }
  assert.equal(ideaCalls, 2);
  assert.equal(formalCalls, 0);
  assert.equal(store.all('drafts').length, 0);
  assert.equal(store.all('jobs').length, 0);
  assert.equal(store.all('answers').length, 0);
});

test('sync never contacts a paired Mac unless the user confirms a valid explicit direction', async t => {
  const calls = [];
  const { api, store } = await fixture(t, { call: async (...args) => { calls.push(args); throw new Error('No sync should be attempted'); } });
  for (const data of [{}, { direction: 'push' }, { direction: 'pull', confirmed: false }, { direction: 'merge', confirmed: true }, { confirmed: true }]) {
    const response = await api('/api/sync', data);
    assert.ok([400, 409].includes(response.status));
  }
  assert.equal(calls.length, 0);
  assert.equal(store.all('words').length, 0);
});

test('phone-to-Mac overwrite keeps the previous Mac progress and does not pull Mac records onto the phone', async t => {
  const mac = await fixture(t);
  await mac.api('/api/words', { textEn: 'mac-only', scope: 'speaking' });
  const calls = [];
  const phone = await fixture(t, { call: async (action, body) => {
    calls.push(action);
    assert.equal(action, 'sync.push');
    assert.equal(body.confirmed, true);
    mac.store.restore(body.value);
    await mac.runtime.persist(true);
    return { ok: true };
  } });
  await phone.api('/api/words', { textEn: 'phone-only', scope: 'speaking' });
  const response = await phone.api('/api/sync', { direction: 'push', confirmed: true });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['sync.push']);
  assert.deepEqual(mac.store.all('words').map(w => w.textEn), ['phone-only']);
  assert.deepEqual(mac.saved.previous.learning.words.map(w => w.textEn), ['mac-only']);
  assert.deepEqual(mac.store.previousBackup().learning.words.map(w => w.textEn), ['mac-only']);
  assert.deepEqual(phone.store.all('words').map(w => w.textEn), ['phone-only']);
});

test('Mac-to-phone overwrite backs up the old phone progress and survives a phone restart', async t => {
  const mac = await fixture(t);
  await mac.api('/api/words', { textEn: 'new-mac-progress', scope: 'speaking' });
  const calls = [];
  const phone = await fixture(t, { call: async action => { calls.push(action); assert.equal(action, 'sync.pull'); return structuredClone(mac.store.backup()); } });
  await phone.api('/api/words', { textEn: 'old-phone-progress', scope: 'speaking' });
  const response = await phone.api('/api/sync', { direction: 'pull', confirmed: true });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['sync.pull']);
  assert.deepEqual(phone.store.all('words').map(w => w.textEn), ['new-mac-progress']);
  assert.deepEqual(phone.saved.previous.learning.words.map(w => w.textEn), ['old-phone-progress']);
  assert.deepEqual(phone.store.previousBackup().learning.words.map(w => w.textEn), ['old-phone-progress']);
  assert.equal(phone.saved.saves.at(-1).restoring, true);
  const restarted = await fixture(t, { saved: phone.saved });
  assert.deepEqual(restarted.store.all('words').map(w => w.textEn), ['new-mac-progress']);
  assert.deepEqual(phone.saved.previous.learning.words.map(w => w.textEn), ['old-phone-progress']);
});

test('a failed overwrite save preserves all current phone records and the previous durable snapshot', async t => {
  const mac = await fixture(t);
  await mac.api('/api/words', { textEn: 'incoming', scope: 'speaking' });
  const phone = await fixture(t, { call: async action => { assert.equal(action, 'sync.pull'); return mac.store.backup(); } });
  await phone.api('/api/words', { textEn: 'must-survive', scope: 'speaking' });
  phone.saved.fail = true;
  const response = await phone.api('/api/sync', { direction: 'pull', confirmed: true });
  assert.equal(response.status, 500);
  assert.deepEqual(phone.store.all('words').map(w => w.textEn), ['must-survive']);
  assert.deepEqual(phone.saved.current.learning.words.map(w => w.textEn), ['must-survive']);
});

test('a phone corpus audit cannot modify identical records after the user pulls a replacement dataset', async t => {
  const entered = deferred(), reply = deferred();
  let incoming;
  const { api, store } = await fixture(t, {
    provider: fakeProvider({ request: async () => { entered.resolve(); return reply.promise; } }),
    call: async action => { assert.equal(action, 'sync.pull'); return structuredClone(incoming); },
  });
  const job = await newJob(api);
  assert.equal((await api(`/api/jobs/${job.id}/generate`, {})).status, 200);
  const original = store.all('expressions')[0];
  incoming = store.backup();
  const audit = api('/api/corpus/audit', { ids: [original.id] });
  await entered.promise;
  assert.equal((await api('/api/sync', { direction: 'pull', confirmed: true })).status, 200);
  assert.deepEqual(store.get('expressions', original.id), original);
  reply.resolve({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reviews: [{ id: original.id, admission: approvedSharing }] }) } }] });
  const stale = await audit;
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /覆盖/);
  assert.deepEqual(store.get('expressions', original.id), original);
});

test('batch extraction creates a preview only, and confirms just the selected source-backed question', async t => {
  const prompt1 = 'What skill would you like to learn in the future?';
  const prompt2 = 'Do you enjoy learning a new skill?';
  const candidates = [prompt1, prompt2].map(promptEn => ({ scope: 'speaking', topicZh: '技能', topicEn: 'Skills', titleZh: '学习技能', promptEn, promptZh: '你想学习什么技能？', part: 'Part 1', taskType: '', cuePoints: [], tags: ['learning'], sourceType: 'reported', sourceNote: '文件题目转录。', visual: null }));
  const text = `Part 1 Skills\n${prompt1}\n${prompt2}`;
  let batchId, modelCalls = 0;
  const nativeCalls = [];
  const { api, store } = await fixture(t, {
    call: async (action, body) => {
      nativeCalls.push(action);
      if (action === 'file.put') { batchId = body.id; return { size: 20, sha256: 'fixture-file-hash' }; }
      if (action === 'file.get') return { base64: Buffer.from('%PDF-fixture').toString('base64'), filename: 'questions.pdf' };
      if (action === 'file.extract') return { format: 'pdf', pageCount: 1, text, pages: [{ page: 1, text }], warnings: [] };
      throw new Error(`Unexpected native call: ${action}`);
    },
    provider: fakeProvider({ request: async () => { modelCalls++; return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: batchId, questions: candidates }) } }] }; } }),
  });
  const upload = await api('/api/batches', { filename: 'questions.pdf', scope: 'speaking', fileBase64: Buffer.from('%PDF-fixture').toString('base64') });
  assert.equal(upload.status, 200);
  const preview = await api(`/api/batches/${batchId}/generate`, {});
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.job.status, 'previewed');
  assert.equal(preview.data.candidates.length, 2);
  assert.equal(preview.data.candidates[0].sourcePage, 1);
  assert.equal(store.all('questions').length, 2);
  assert.equal(modelCalls, 1);
  assert.deepEqual(nativeCalls, ['file.put', 'file.get', 'file.extract']);
  const commit = await api(`/api/batches/${batchId}/commit`, { selectedKeys: [preview.data.candidates[0].key] });
  assert.equal(commit.status, 200);
  assert.equal(commit.data.imported, 1);
  assert.equal(store.all('questions').length, 3);
  assert.ok(store.all('questions').some(q => q.promptEn === prompt1 && q.sourcePage === 1));
  assert.ok(!store.all('questions').some(q => q.promptEn === prompt2));
  assert.equal((await api(`/api/batches/${batchId}/commit`, { selectedKeys: [preview.data.candidates[1].key] })).status, 409);
});
