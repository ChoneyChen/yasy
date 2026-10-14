import { approvedConfidence } from './admission-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { getReviewQueue, recordReview } from '../server/reviews.mjs';
import { batchFile } from '../server/batches.mjs';

const source = { id: 'feature-source', title: 'Feature test fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-13', note: 'Only for tests' };
const topics = ['speaking', 'writing-task1', 'writing-task2'].map((scope, i) => ({ id: `feature-topic-${i}`, scope, titleZh: '学习', titleEn: `Learning ${i}`, description: '', tags: ['learning'] }));
const question = (id, scope, promptEn = 'Do you enjoy learning English with friends?') => ({
  id, scope, topicId: topics.find(t => t.scope === scope).id, sourceId: source.id, sourceType: 'adapted',
  titleZh: '一起学习', promptEn, promptZh: '你喜欢和朋友一起学英语吗？', tags: ['learning'],
  ...(scope === 'speaking' ? { part: 'Part 1' } : {}),
});
const bank = { sources: [source], topics, questions: [question('feature-speaking-1', 'speaking'), question('feature-speaking-2', 'speaking', 'Why do you enjoy sharing experiences?'), question('feature-writing-1', 'writing-task1'), question('feature-writing-2', 'writing-task2', 'Some people prefer learning alone, while others prefer learning with friends. Discuss both views and give your opinion.')] };
const draftZh = '我喜欢和朋友一起学英语，因为我们可以分享各自真实的经历。我会先写下中文素材，然后练习把这个故事清楚地讲出来，这让我越来越有信心，也帮助朋友更好地了解我的想法。';
const prose = 'I enjoy learning English with friends because it helps me build confidence. We share real experiences and help each other express ideas clearly every week.';
const essay = `Learning with friends can help people build confidence, although studying alone also has advantages. In my view, the most useful approach combines focused individual preparation with regular opportunities to discuss ideas with other learners.

Individual study allows learners to work at a pace that suits their needs. A person who finds a topic difficult can spend more time on it without feeling that they are delaying a group. Working alone can also make it easier to concentrate, especially when a task requires careful reading or sustained practice. These benefits explain why independent preparation remains an important part of learning.

However, learning with friends gives people opportunities to express ideas and receive feedback. In a small language learning group, for example, members can share real experiences and ask each other questions. This helps them notice when an explanation is unclear and practise giving more specific details. Support from other learners can also make speaking feel less intimidating, encouraging people to participate rather than remain silent.

The two approaches can therefore serve different purposes. Learners can first prepare their own ideas individually, then use a group discussion to test whether those ideas are understandable. Afterwards, they can return to independent practice to address difficulties identified during the discussion. This sequence preserves concentration while also providing meaningful interaction, rather than treating individual and group study as competing alternatives.

In conclusion, studying alone supports focused preparation, while learning with friends provides feedback and opportunities for expression. I believe combining these approaches is more useful than relying entirely on either one, because learners need both time to develop their own understanding and opportunities to communicate it clearly.`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'yasy-features-'));
  const store = new Store({ file: join(dir, 'yasy.sqlite'), bank });
  const server = createServer(createApp(store));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const upload = async (scope = 'mixed') => {
    const response = await api('/api/batches', { filename: 'my-questions.pdf', scope, fileBase64: pdf.toString('base64') });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.job;
  };
  return { dir, store, base, api, upload };
}

function batchQuestion(promptEn, changes = {}) {
  return {
    scope: 'speaking', topicZh: '生活与学习', topicEn: 'Life and learning', titleZh: '分享经历',
    promptEn, promptZh: '你喜欢分享自己的经历吗？', part: 'Part 1', taskType: '', cuePoints: [],
    tags: ['learning'], sourceNote: 'my-questions.pdf, page 1, question 1. File transcription; season unverified.', sourceType: 'reported', visual: null,
    ...changes,
  };
}

function answerResult(job) {
  return {
    requestId: job.id, questionId: job.questionId, scope: job.scope, quality: { passed: true, suggestions: [] },
    answer: { textEn: prose, outlineZh: '直接回答，说明共同学习的收益。', materialSpans: [{ quote: prose, materialIndex: 0 }] },
    materials: [{ title: 'Learning with friends', summaryZh: '和朋友交流真实经历提升表达信心', summaryEn: 'Sharing real experiences with friends builds confidence.', detailZh: draftZh, detailEn: prose, tags: ['learning'] }],
    expressions: [{ textEn: 'build confidence', meaningZh: '建立信心', category: '情绪态度', categoryEn: 'Feelings and attitudes', exampleEn: 'Practice can help build confidence.', usageNote: '用于描述练习带来的自信。', usageNoteEn: 'Use this collocation for confidence gained through practice.', tags: ['confidence'], materialIndexes: [0], admission: approvedConfidence }],
    recommendations: [],
  };
}

async function completeAnswer(f, questionId = 'feature-speaking-1', changes) {
  const textZh = f.store.question(questionId).scope === 'writing-task2' ? draftZh + '另一方面，独自学习也有利于专注，需要根据任务把个人准备与小组交流结合起来。' : draftZh;
  const created = await f.api('/api/jobs', { questionId, textZh, materialIds: [] });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const payload = answerResult(created.data.job);
  if (changes) changes(payload);
  const imported = await f.api(`/api/jobs/${created.data.job.id}/result`, { result: payload });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  return f.store.all('answers').find(a => a.questionId === questionId);
}

test('PDF uploads check signature and preserve original bytes privately on the Mac', async t => {
  const f = await fixture(t);
  const bad = await f.api('/api/batches', { filename: 'bad.pdf', fileBase64: Buffer.from('not a PDF').toString('base64') });
  assert.equal(bad.status, 400);
  assert.equal(f.store.all('batch_jobs').length, 0);
  const job = await f.upload();
  const file = join(f.dir, 'uploads', `${job.id}.pdf`);
  assert.ok(existsSync(file));
  assert.deepEqual(readFileSync(file), pdf);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(job.sha256, createHash('sha256').update(pdf).digest('hex'));
  const response = await fetch(`${f.base}/api/batches/${job.id}/file`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
});

test('batch preview changes no bank records; commit selects only chosen questions and deduplicates later imports', async t => {
  const f = await fixture(t);
  const job = await f.upload('speaking');
  const count = f.store.all('questions').length;
  const questions = [batchQuestion('Do you enjoy sharing your experiences?'), batchQuestion('Where do you usually meet your friends?'), batchQuestion('Do you enjoy sharing your experiences?')];
  const preview = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions } });
  assert.equal(preview.status, 200);
  assert.equal(f.store.all('questions').length, count);
  assert.equal(f.store.all('sources').length, 1);
  assert.equal(preview.data.candidates[2].duplicate, true);
  const selected = [preview.data.candidates[0].key, preview.data.candidates[2].key];
  const commit = await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: selected });
  assert.equal(commit.status, 200);
  assert.equal(commit.data.imported, 1);
  assert.equal(commit.data.skipped, 1);
  assert.equal(f.store.all('questions').length, count + 1);
  assert.ok(!f.store.all('questions').some(q => q.promptEn === questions[1].promptEn));
  assert.equal((await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: selected })).status, 409);
  const next = await f.upload('speaking');
  const again = await f.api(`/api/batches/${next.id}/preview`, { result: { requestId: next.id, questions: [questions[0]] } });
  assert.equal(again.data.candidates[0].duplicate, true);
  const repeated = await f.api(`/api/batches/${next.id}/commit`, { selectedKeys: [again.data.candidates[0].key] });
  assert.equal(repeated.data.imported, 0);
  assert.equal(repeated.data.skipped, 1);
  assert.equal(f.store.all('questions').length, count + 1);
});

test('batch tasks reject wrong bindings, other scopes and foreign selection keys without partial imports', async t => {
  const f = await fixture(t);
  const job = await f.upload('speaking');
  const original = f.store.all('questions').length;
  assert.equal((await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: 'wrong-task', questions: [batchQuestion('Is learning enjoyable?')] } })).status, 409);
  assert.equal((await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions: [batchQuestion('Discuss both views.', { scope: 'writing-task2', part: '', taskType: 'discussion essay' })] } })).status, 400);
  assert.equal(f.store.get('batch_jobs', job.id).status, 'pending');
  const preview = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions: [batchQuestion('Is learning enjoyable?')] } });
  assert.equal(preview.status, 200);
  assert.equal((await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: ['another-task:0'] })).status, 400);
  assert.equal(f.store.all('questions').length, original);
  assert.equal(f.store.all('sources').length, 1);
});

test('Part 2 cards with the same opening but different cue points remain independent questions', async t => {
  const f = await fixture(t);
  const job = await f.upload('speaking');
  const opening = 'Describe a journey you enjoyed.';
  const first = batchQuestion(opening, { part: 'Part 2', cuePoints: ['Where you went', 'Who you went with', 'Why you enjoyed it'] });
  const second = batchQuestion(opening, { part: 'Part 2', cuePoints: ['Where you went', 'What happened during the journey', 'What you learned from it'] });
  const preview = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions: [first, second] } });
  assert.equal(preview.status, 200);
  assert.ok(preview.data.candidates.every(q => !q.duplicate));
  const commit = await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: preview.data.candidates.map(q => q.key) });
  assert.equal(commit.status, 200);
  assert.equal(commit.data.imported, 2);
});

test('Task 1 table preview rejects mismatched columns and values instead of importing ambiguous data', async t => {
  const f = await fixture(t);
  const job = await f.upload('writing-task1');
  const malformed = batchQuestion('The table shows visitor numbers. Summarise the information.', {
    scope: 'writing-task1', part: '', taskType: 'table',
    visual: { kind: 'table', title: 'Visitors by year', columns: ['Year', 'Visitors'], rows: [[2020, 500, 999]], steps: [], note: '' },
  });
  const response = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions: [malformed] } });
  assert.equal(response.status, 400);
  assert.equal(f.store.get('batch_jobs', job.id).status, 'pending');
  assert.equal(f.store.all('questions').length, bank.questions.length);
});

test('map questions with distinct spatial information are not deduplicated merely because their titles match', async t => {
  const f = await fixture(t);
  const job = await f.upload('writing-task1');
  const common = batchQuestion('The maps show changes in a town between 1980 and 2020. Summarise the information.', { scope: 'writing-task1', part: '', taskType: 'map' });
  const visual = { kind: 'map', title: 'Town in 1980 and 2020', columns: [], rows: [], steps: [], note: 'The factory in the north was replaced by a library; the southern park remained unchanged.' };
  const questions = [{ ...common, visual }, { ...common, visual: { ...visual, note: 'The factory in the north was replaced by a park; the southern library remained unchanged.' } }];
  const preview = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions } });
  assert.equal(preview.status, 200);
  assert.ok(preview.data.candidates.every(q => !q.duplicate));
  const committed = await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: preview.data.candidates.map(q => q.key) });
  assert.equal(committed.data.imported, 2);
});

test('backup restore preserves user-upload sources and batch metadata; missing original files fail explicitly', async t => {
  const f = await fixture(t);
  const job = await f.upload();
  const preview = await f.api(`/api/batches/${job.id}/preview`, { result: { requestId: job.id, questions: [batchQuestion('Who do you enjoy studying with?')] } });
  const committed = await f.api(`/api/batches/${job.id}/commit`, { selectedKeys: [preview.data.candidates[0].key] });
  assert.equal(committed.status, 200);
  const backup = (await f.api('/api/backup')).data;
  const savedSource = backup.bank.sources.find(s => s.type === 'user-upload');
  assert.equal(savedSource.url, `/api/batches/${job.id}/file`);
  const targetDir = mkdtempSync(join(tmpdir(), 'yasy-restored-feature-'));
  const target = new Store({ file: join(targetDir, 'yasy.sqlite'), bank });
  t.after(() => { target.close(); rmSync(targetDir, { recursive: true, force: true }); });
  target.restore(backup);
  assert.deepEqual(target.get('sources', savedSource.id), savedSource);
  assert.equal(target.get('batch_jobs', job.id).status, 'completed');
  assert.ok(target.all('questions').some(q => q.sourceId === savedSource.id));
  await assert.rejects(batchFile(target, job.id), e => e.status === 404 && e.message.includes('uploads'));
  const restoredSameMac = await f.api('/api/backup', { backup });
  assert.equal(restoredSameMac.status, 200);
  assert.equal((await fetch(`${f.base}${savedSource.url}`)).status, 200);
});

test('review queues return one due item at a time in chronological order and keep speaking/writing/words separate', async t => {
  const f = await fixture(t);
  const first = await completeAnswer(f);
  const second = await completeAnswer(f, 'feature-speaking-2');
  f.store.insert('answers', { ...first, updatedAt: '2020-01-01T00:00:00.000Z' });
  f.store.insert('answers', { ...second, updatedAt: '2021-01-01T00:00:00.000Z' });
  const at = new Date('2030-01-01T00:00:00.000Z');
  const queue = getReviewQueue(f.store, 'speaking', at);
  assert.equal(queue.item.id, first.id);
  assert.equal(queue.remaining, 2);
  assert.ok(!('items' in queue));
  recordReview(f.store, 'answer', first.id, at);
  const next = getReviewQueue(f.store, 'speaking', at);
  assert.equal(next.item.id, second.id);
  assert.equal(next.remaining, 1);
  const writing = await completeAnswer(f, 'feature-writing-2', payload => {
    payload.answer.textEn = essay;
    payload.answer.materialSpans = [{ quote: 'Learning with friends can help people build confidence, although studying alone also has advantages.', materialIndex: 0 }];
    payload.materials[0].detailZh += '另一方面，独自学习也有利于专注，需要根据任务把个人准备与小组交流结合起来。';
    payload.materials[0].detailEn += ' Independent study also supports concentration. Individual preparation and group discussions should be combined to suit the task.';
  });
  const writingQueue = getReviewQueue(f.store, 'writing', at);
  assert.equal(writingQueue.total, 1);
  assert.equal(writingQueue.item.id, writing.id);
  assert.equal(getReviewQueue(f.store, 'speaking', at).total, 2);
  assert.equal(getReviewQueue(f.store, 'words', at).total, 0);
  assert.equal((await f.api('/api/reviews/next?kind=speaking')).status, 200);
});

test('review counts accumulate and schedule 1, 3, 7 day intervals before capping at 90 days', async t => {
  const f = await fixture(t);
  const word = f.store.addWord({ textEn: 'confidence', scope: 'speaking' });
  let at = new Date('2030-01-01T00:00:00.000Z');
  const expected = [1, 3, 7, 14, 30, 60, 90, 90];
  expected.forEach((interval, index) => {
    const reviewed = recordReview(f.store, 'word', word.id, at);
    assert.equal(reviewed.reviewCount, index + 1);
    assert.equal(reviewed.intervalDays, interval);
    assert.equal(Date.parse(reviewed.dueAt) - at.getTime(), interval * 86400000);
    assert.equal(getReviewQueue(f.store, 'words', at).item, null);
    at = new Date(reviewed.dueAt);
    assert.equal(getReviewQueue(f.store, 'words', at).item.id, word.id);
  });
  assert.equal(f.store.all('review_events').length, expected.length);
});

test('rewriting an answer makes it due immediately and resets the stage while retaining total reviews', async t => {
  const f = await fixture(t);
  const answer = await completeAnswer(f);
  const reviewed = await f.api('/api/reviews', { kind: 'answer', id: answer.id });
  assert.equal(reviewed.status, 200);
  assert.equal((await f.api('/api/reviews/next?kind=speaking')).data.item, null);
  // The earlier version is a clearly distinct timestamp, avoiding dependence
  // on the wall clock's millisecond resolution during a fast local rewrite.
  f.store.insert('answers', { ...answer, updatedAt: '2000-01-01T00:00:00.000Z' });
  f.store.insert('review_states', { ...reviewed.data, answerUpdatedAt: '2000-01-01T00:00:00.000Z' });
  assert.equal((await f.api('/api/reviews/next?kind=speaking')).data.item, null);
  const rewritten = await completeAnswer(f, 'feature-speaking-1', payload => { payload.answer.textEn += ' It also makes our conversations more meaningful.'; });
  assert.equal(rewritten.id, answer.id);
  const due = (await f.api('/api/reviews/next?kind=speaking')).data;
  assert.equal(due.item.id, answer.id);
  assert.equal(due.item.reviewCount, 1);
  const repeated = await f.api('/api/reviews', { kind: 'answer', id: answer.id });
  assert.equal(repeated.data.reviewCount, 2);
  assert.equal(repeated.data.stageCount, 1);
  assert.equal(repeated.data.intervalDays, 1);
});

test('deleting a reviewed word removes active scheduling and still allows an intact backup restore', async t => {
  const f = await fixture(t);
  const word = (await f.api('/api/words', { textEn: 'confidence', scope: 'speaking' })).data;
  assert.equal((await f.api('/api/reviews', { kind: 'word', id: word.id })).status, 200);
  assert.equal((await f.api(`/api/words/${word.id}`, undefined, 'DELETE')).status, 200);
  assert.equal(f.store.all('review_states').length, 0);
  assert.equal(getReviewQueue(f.store, 'words').total, 0);
  const backup = f.store.backup();
  assert.equal((await f.api('/api/backup', { backup })).status, 200);
  assert.equal(f.store.all('words').length, 0);
  assert.equal(f.store.all('review_states').length, 0);
});

test('v1 reader APIs retain all bilingual content and material annotations and reject writes', async t => {
  const f = await fixture(t);
  const answer = await completeAnswer(f);
  const manifest = await f.api('/api/v1/manifest');
  assert.equal(manifest.data.schemaVersion, 1);
  assert.equal(manifest.data.readOnly, true);
  assert.equal(manifest.data.connectivity, 'loopback-only');
  const snapshot = await f.api('/api/v1/snapshot');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.schemaVersion, 1);
  const content = await f.api(`/api/v1/content/${answer.questionId}`);
  assert.equal(content.status, 200);
  assert.equal(content.data.answer.id, answer.id);
  assert.deepEqual(content.data.answer.materialSpans, answer.materialSpans);
  for (const key of ['summaryZh', 'summaryEn', 'detailZh', 'detailEn']) assert.ok(content.data.materials[0][key]);
  for (const key of ['meaningZh', 'category', 'categoryEn', 'usageNote', 'usageNoteEn']) assert.ok(content.data.expressions[0][key]);
  assert.deepEqual(snapshot.data.state.materials, content.data.materials);
  const span = content.data.answer.materialSpans[0];
  assert.equal(content.data.answer.textEn.slice(span.start, span.end), prose);
  assert.equal(span.materialId, content.data.materials[0].id);
  const count = f.store.all('answers').length;
  for (const path of ['/api/v1/manifest', '/api/v1/snapshot', `/api/v1/content/${answer.questionId}`]) assert.ok((await f.api(path, {})).status >= 400);
  assert.equal(f.store.all('answers').length, count);
});

test('review ordering compares actual instants when valid due dates contain timezone offsets', async t => {
  const f = await fixture(t);
  const early = f.store.addWord({ textEn: 'earlier', scope: 'speaking' });
  const late = f.store.addWord({ textEn: 'later', scope: 'speaking' });
  const earlier = recordReview(f.store, 'word', early.id, new Date('2026-10-01T00:00:00.000Z'));
  const later = recordReview(f.store, 'word', late.id, new Date('2026-10-01T00:00:00.000Z'));
  f.store.insert('review_states', { ...earlier, dueAt: '2026-10-13T01:00:00+08:00' });
  f.store.insert('review_states', { ...later, dueAt: '2026-10-12T22:00:00.000Z' });
  assert.equal(getReviewQueue(f.store, 'words', new Date('2030-01-01T00:00:00.000Z')).item.id, early.id);
});
