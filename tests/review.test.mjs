import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { wordCount } from '../server/domain.mjs';

const bank = {
  sources: [{ id: 'review-source', title: 'Review fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-13', note: 'Test fixture' }],
  topics: [{ id: 'review-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: '', tags: ['learning'] }],
  questions: [{ id: 'review-question', scope: 'speaking', topicId: 'review-topic', sourceId: 'review-source', sourceType: 'adapted', part: 'Part 1', titleZh: '你喜欢学习吗', promptEn: 'Do you enjoy learning?', promptZh: '你喜欢学习吗？', tags: ['learning'] }],
};
const draft = '我喜欢和朋友一起学英语，因为我们可以分享各自真实的经历。我会先写下中文素材，然后练习把这个故事清楚地讲出来。';

async function fixture(t) {
  const store = new Store({ file: ':memory:', bank });
  const server = createServer(createApp(store));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const api = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const makeJob = async () => {
    const response = await api('/api/jobs', { questionId: 'review-question', textZh: draft, materialIds: [] });
    assert.equal(response.status, 200);
    return response.data.job;
  };
  return { store, server, base, api, makeJob };
}

function result(job) {
  return {
    requestId: job.id, questionId: job.questionId, scope: job.scope,
    quality: { passed: true, suggestions: [] },
    answer: { textEn: 'Yes, I enjoy learning English with my friends because we can share our experiences and help each other express our ideas clearly.', outlineZh: '直接回答，说明原因。', materialSpans:[{quote:'Yes, I enjoy learning English with my friends because we can share our experiences and help each other express our ideas clearly.',materialIndex:0}] },
    materials: [{ title: 'Learning with friends', summaryZh: '通过分享真实经历学习英语', detailZh: draft, summaryEn:'Learning through real experiences.',detailEn:'My friends and I learn English by sharing our experiences.',tags: ['learning'] }],
    expressions: [{ textEn: 'share our experiences', meaningZh: '分享我们的经历', category: '口语搭配',categoryEn:'Spoken collocation', exampleEn: 'We can share our experiences.', usageNote: '用于交流真实经历。',usageNoteEn:'Use when talking about real experiences.', tags: ['learning'], materialIndexes: [0] }],
    recommendations: [],
  };
}

// Hold the final bytes of a real HTTP upload. This models a slow connection,
// independent of the server's internal scheduling and validation functions.
async function heldImport(server, base, job) {
  const payload = JSON.stringify({ result: result(job) });
  let resolveSeen;
  const seen = new Promise(resolve => { resolveSeen = resolve; });
  const listener = req => {
    if (req.url === `/api/jobs/${job.id}/result`) {
      server.off('request', listener);
      resolveSeen();
    }
  };
  server.on('request', listener);
  let req;
  const response = new Promise((resolve, reject) => {
    req = request(`${base}/api/jobs/${job.id}/result`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.flushHeaders();
    req.write(payload.slice(0, -1));
  });
  await seen;
  return { finish() { req.end(payload.slice(-1)); return response; } };
}

test('an AI upload superseded by a newer job cannot complete the old job', async t => {
  const { store, server, base, makeJob } = await fixture(t);
  const old = await makeJob();
  const uploading = await heldImport(server, base, old);
  const latest = await makeJob();
  assert.equal(store.get('jobs', old.id).status, 'needs-revision');
  const response = await uploading.finish();
  assert.equal(response.status, 409);
  assert.equal(store.all('answers').length, 0);
  assert.equal(store.get('jobs', latest.id).status, 'pending');
});

test('editing a draft while an AI result is uploading prevents stale content from being saved', async t => {
  const { store, server, base, api, makeJob } = await fixture(t);
  const job = await makeJob();
  const uploading = await heldImport(server, base, job);
  const changed = await api('/api/drafts/review-question', { textZh: draft + '我已经修改了新的事实。', materialIds: [] }, 'PUT');
  assert.equal(changed.status, 200);
  const response = await uploading.finish();
  assert.equal(response.status, 409);
  assert.equal(store.all('answers').length, 0);
  assert.equal(store.get('drafts', job.questionId).textZh, draft + '我已经修改了新的事实。');
});

test('two copies of the same AI import do not create a second revision or mutate the completed answer', async t => {
  const { store, server, base, api, makeJob } = await fixture(t);
  const job = await makeJob();
  const uploading = await heldImport(server, base, job);
  assert.equal((await api(`/api/jobs/${job.id}/result`, { result: result(job) })).status, 200);
  const response = await uploading.finish();
  assert.equal(response.status, 409);
  assert.equal(store.all('revisions').length, 0);
  assert.equal(store.all('answers').length, 1);
});

test('saving an existing word without new annotations preserves its meaning and example', async t => {
  const { store, api } = await fixture(t);
  await api('/api/words', { textEn: 'confidence', scope: 'speaking', meaningZh: '信心', exampleEn: 'Practice builds confidence.' });
  await api('/api/words', { textEn: 'Confidence', scope: 'speaking' });
  const words = store.all('words');
  assert.equal(words.length, 1);
  assert.equal(words[0].meaningZh, '信心');
  assert.equal(words[0].exampleEn, 'Practice builds confidence.');
});

test('word counts include numeric tokens used in Academic Task 1', () => {
  assert.equal(wordCount('In 2010, sales reached 25% and fell to 1,000.'), 9);
});

test('restore rejects pending jobs with unknown recommendation candidates and keeps current data', async t => {
  const { store, makeJob } = await fixture(t);
  await makeJob();
  store.addWord({ textEn: 'preserved', scope: 'speaking', meaningZh: '应保留的记录' });
  const malformed = store.backup();
  malformed.learning.jobs[0].candidateIds = ['missing-candidate'];
  malformed.learning.words = [];
  assert.throws(() => store.restore(malformed));
  assert.equal(store.all('words')[0].textEn, 'preserved');
});

test('AI output cannot associate more than the three best expressions with one material', async t => {
  const { store, api, makeJob } = await fixture(t);
  const job = await makeJob();
  const payload = result(job);
  payload.expressions = ['enjoy learning English', 'share our experiences', 'help each other', 'express our ideas clearly'].map(textEn => ({
    ...payload.expressions[0], textEn, materialIndexes: [0],
  }));
  const response = await api(`/api/jobs/${job.id}/result`, { result: payload });
  assert.equal(response.status, 400);
  assert.equal(store.all('answers').length, 0);
});
