import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { getPracticeNext } from '../server/practice.mjs';

const source = { id: 'practice-source', title: 'Practice selector fixture', url: 'https://example.invalid/', type: 'reported', accessedAt: '2026-10-15', note: 'Synthetic local tests only.' };
const topics = ['speaking', 'writing-task1', 'writing-task2'].map(scope => ({ id: `topic-${scope}`, scope, titleZh: '测试主题', titleEn: 'Test topic', description: '', tags: [] }));
const question = (id, scope = 'speaking', extra = {}) => ({ id, scope, topicId: `topic-${scope}`, sourceId: source.id, titleZh: '测试题', promptEn: `Practice question ${id}?`, promptZh: '测试问题？', tags: [], sourceType: 'adapted', ...(scope === 'speaking' ? { part: 'Part 1' } : {}), ...extra });
const questions = [question('sp-a'), question('task1', 'writing-task1'), question('sp-b'), question('task2', 'writing-task2'), question('sp-c'), question('sp-archived', 'speaking', { active: false })];
const bank = { sources: [source], topics, questions };
const answered = questionId => ({ id: `answer-${questionId}`, questionId });
const busy = (questionId, id = `job-${questionId}`) => ({ id, questionId, status: 'processing' });
function memoryView({ questions: items = questions, answers = [], jobs = [] } = {}) {
  const tables = structuredClone({ questions: items, answers, jobs });
  return { tables, all: name => tables[name] };
}
const result = (question, remaining, waiting = 0, reason = 'ready') => ({ question, remaining, waiting, reason });

test('first follows the published order and archive filtering for each practice kind', () => {
  const store = memoryView();
  assert.deepEqual(getPracticeNext(store, { kind: 'speaking', mode: 'first' }), result(questions[0], 3));
  assert.deepEqual(getPracticeNext(store, { kind: 'writing', mode: 'first' }), result(questions[1], 2));
  assert.equal(getPracticeNext(store, { kind: 'writing', mode: 'switch', currentId: 'task1' }).question.scope, 'writing-task2');
  assert.equal(getPracticeNext(store, { kind: 'writing', mode: 'switch', currentId: 'task2' }).question.scope, 'writing-task1');
});

test('remaining counts unfinished questions and waiting counts distinct busy unfinished questions only', () => {
  const store = memoryView({ answers: [answered('sp-a'), answered('task1')], jobs: [busy('sp-a'), busy('sp-b'), busy('sp-b', 'duplicate-job'), busy('task2'), busy('sp-archived')] });
  assert.deepEqual(getPracticeNext(store, { kind: 'speaking' }), result(questions[4], 2, 1));
  assert.deepEqual(getPracticeNext(store, { kind: 'writing' }), result(null, 1, 1, 'processing'));
});

test('pending, failed, revision and completed jobs do not prevent editable unfinished practice', () => {
  const store = memoryView({ jobs: ['pending', 'failed', 'needs-revision', 'completed'].map((status, index) => ({ id: `old-${index}`, questionId: 'sp-a', status })) });
  assert.deepEqual(getPracticeNext(store, { kind: 'speaking' }), result(questions[0], 3));
});

test('switch starts after the current active question, skips completed/busy questions and wraps', () => {
  const store = memoryView({ answers: [answered('sp-a')], jobs: [busy('sp-b')] });
  assert.deepEqual(getPracticeNext(store, { kind: 'speaking', mode: 'switch', currentId: 'sp-a' }), result(questions[4], 2, 1));
  const ready = memoryView();
  assert.equal(getPracticeNext(ready, { kind: 'speaking', mode: 'switch', currentId: 'sp-c' }).question.id, 'sp-a');
  assert.equal(getPracticeNext(ready, { kind: 'speaking', mode: 'switch', currentId: 'sp-a' }).question.id, 'sp-b');
  assert.equal(getPracticeNext(ready, { kind: 'speaking', mode: 'switch' }).question.id, 'sp-a');
});

test('random uses an injectable sample over eligible noncurrent questions in both end buckets', () => {
  const store = memoryView();
  assert.equal(getPracticeNext(store, { kind: 'speaking', mode: 'random', currentId: 'sp-b', random: () => 0 }).question.id, 'sp-a');
  assert.equal(getPracticeNext(store, { kind: 'speaking', mode: 'random', currentId: 'sp-b', random: () => 0.99999 }).question.id, 'sp-c');
  const skipped = memoryView({ answers: [answered('sp-a')], jobs: [busy('sp-b')] });
  assert.deepEqual(getPracticeNext(skipped, { kind: 'speaking', mode: 'random', random: () => 0 }), result(questions[4], 2, 1));
});

test('all modes exclude current when another unfinished editable question exists', () => {
  const store = memoryView();
  for (const mode of ['first', 'switch', 'random']) assert.notEqual(getPracticeNext(store, { kind: 'speaking', mode, currentId: 'sp-a', random: () => 0 }).question.id, 'sp-a');
});

test('only-current returns that editable question without repeating busy work', () => {
  const store = memoryView({ answers: [answered('sp-a'), answered('sp-c')] });
  for (const mode of ['first', 'switch', 'random']) assert.deepEqual(getPracticeNext(store, { kind: 'speaking', mode, currentId: 'sp-b' }), result(questions[2], 1, 0, 'only-current'));
  const withWaiting = memoryView({ jobs: [busy('sp-a'), busy('sp-c')] });
  assert.deepEqual(getPracticeNext(withWaiting, { kind: 'speaking', mode: 'switch', currentId: 'sp-b' }), result(questions[2], 3, 2, 'only-current'));
});

test('all-busy returns processing including a busy current question', () => {
  const store = memoryView({ jobs: ['sp-a', 'sp-b', 'sp-c'].map(id => busy(id)) });
  assert.deepEqual(getPracticeNext(store, { kind: 'speaking', currentId: 'sp-b' }), result(null, 3, 3, 'processing'));
  const single = memoryView({ answers: [answered('sp-a'), answered('sp-c')], jobs: [busy('sp-b')] });
  assert.deepEqual(getPracticeNext(single, { kind: 'speaking', mode: 'switch', currentId: 'sp-b' }), result(null, 1, 1, 'processing'));
});

test('all-completed and an empty kind have distinct empty states', () => {
  const completed = memoryView({ answers: ['sp-a', 'sp-b', 'sp-c'].map(answered), jobs: [busy('sp-a')] });
  assert.deepEqual(getPracticeNext(completed, { kind: 'speaking' }), result(null, 0, 0, 'all-completed'));
  const empty = memoryView({ questions: [question('archived-only', 'speaking', { active: false }), question('task1', 'writing-task1')] });
  assert.deepEqual(getPracticeNext(empty, { kind: 'speaking' }), result(null, 0, 0, 'no-questions'));
  assert.deepEqual(getPracticeNext(memoryView({ questions: [] }), { kind: 'writing' }), result(null, 0, 0, 'no-questions'));
});

test('enum, current activity and same-kind validation return useful 400 or 404 failures', () => {
  const store = memoryView();
  const fails = (input, status) => assert.throws(() => getPracticeNext(store, input), error => error.status === status);
  for (const kind of [undefined, '', 'all', 'writing-task1']) fails({ kind }, 400);
  for (const mode of ['', 'next', 'FIRST']) fails({ kind: 'speaking', mode }, 400);
  for (const currentId of ['', null, 99]) fails({ kind: 'speaking', currentId }, 400);
  fails({ kind: 'speaking', currentId: 'unknown' }, 404);
  fails({ kind: 'speaking', currentId: 'sp-archived' }, 404);
  fails({ kind: 'speaking', currentId: 'task1' }, 400);
  fails({ kind: 'writing', currentId: 'sp-a' }, 400);
  for (const value of [-1, 1, NaN, Infinity]) fails({ kind: 'speaking', mode: 'random', random: () => value }, 400);
});

test('selection is read-only and never marks questions complete or schedules a plan', () => {
  const store = memoryView({ answers: [answered('sp-a')], jobs: [busy('sp-b')] }); const before = structuredClone(store.tables);
  getPracticeNext(store, { kind: 'speaking', mode: 'random', random: () => 0.4 });
  getPracticeNext(store, { kind: 'writing', mode: 'switch', currentId: 'task1' });
  assert.deepEqual(store.tables, before);
});

test('HTTP selector and v2 manifest expose the same read-only selection contract', async t => {
  const store = new Store({ file: ':memory:', bank });
  const server = createServer(createApp(store));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const get = async path => { const response = await fetch(base + path); return { status: response.status, data: await response.json() }; };
  const before = store.backup();
  assert.deepEqual((await get('/api/practice/next?kind=speaking&mode=first')).data, result(questions[0], 3));
  assert.equal((await get('/api/practice/next?kind=writing&mode=switch&currentId=task1')).data.question.id, 'task2');
  assert.deepEqual((await get('/api/practice/next?kind=speaking&mode=random&currentId=sp-a')).data.remaining, 3);
  for (const path of ['/api/practice/next', '/api/practice/next?kind=invalid', '/api/practice/next?kind=speaking&mode=invalid', '/api/practice/next?kind=speaking&currentId=task1', '/api/practice/next?kind=speaking&currentId=']) assert.equal((await get(path)).status, 400);
  for (const id of ['unknown', 'sp-archived']) assert.equal((await get(`/api/practice/next?kind=speaking&currentId=${id}`)).status, 404);
  const manifest = (await get('/api/v2/manifest')).data;
  assert.equal(manifest.endpoints.practice, '/api/practice/next'); assert.equal(manifest.deviceRole, 'full-client'); assert.equal(manifest.connectivity, 'loopback-only');
  assert.deepEqual(store.backup().learning, before.learning, 'GET selectors and the manifest must not create drafts, jobs or plans');
});
