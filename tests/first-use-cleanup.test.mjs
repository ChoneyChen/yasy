import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { day, wordCount } from '../server/domain.mjs';
import { clearFirstUseFromBackup } from '../server/learning-cleanup.mjs';
import { readLearningBackup, runFirstUseCleanup } from '../scripts/clear-first-use.mjs';

const script = fileURLToPath(new URL('../scripts/clear-first-use.mjs', import.meta.url));
const PRIVATE = 'PRIVATE-LEARNING-BODY-NOT-FOR-LOGS';
const KEY = 'FAKE-API-KEY-NOT-FOR-LOGS-123456789';
const source = { id: 'cleanup-source', title: 'Cleanup test source', url: 'https://example.invalid/', type: 'reported', accessedAt: '2026-10-15', note: 'Synthetic fixtures only.' };
const topic = { id: 'cleanup-topic', scope: 'speaking', titleZh: '测试主题', titleEn: 'Test topic', tags: [], description: '' };
const bank = { sources: [source], topics: [topic], questions: ['q-other', 'q-first', 'q-draft', 'q-job'].map(id => ({ id, topicId: topic.id, sourceId: source.id, scope: 'speaking', titleZh: id === 'q-first' ? '首次测试题' : '其他测试题', promptEn: 'Do you like practising English?', promptZh: '你喜欢练习英语吗？', sourceType: 'adapted', part: 'Part 1', tags: [] })) };
const textEn = 'I enjoy practising English with friends because their encouragement helps me build confidence. We share real experiences and explain our ideas clearly.';
const material = id => ({ id, scope: 'speaking', version: 2, title: 'Practice with friends', summaryZh: '朋友鼓励我练习英语', summaryEn: 'Friends encourage my English practice.', detailZh: `真实素材 ${PRIVATE}`, detailEn: textEn, tags: ['learning'], createdAt: '2026-01-01T00:00:00Z' });
const expression = id => ({ id, scope: 'speaking', textEn: 'build confidence', meaningZh: '建立信心', category: '自然搭配', categoryEn: 'Natural collocations', usageNote: `用法 ${PRIVATE}`, usageNoteEn: 'Use this collocation for confidence gained through practice.', exampleEn: 'Regular practice can help build confidence.', tags: ['learning'], createdAt: '2026-01-01T00:00:00Z', admission: { status: 'approved', reasonZh: '自然搭配，可迁移。', reasonEn: 'A useful natural collocation.', policyVersion: 2 } });
const job = (id, questionId, createdAt, extra = {}) => ({ id, questionId, scope: 'speaking', status: 'completed', prompt: `Synthetic prompt ${PRIVATE}`, textZh: `中文想法 ${PRIVATE}`, materialIds: [], candidateIds: [], createdAt, ...extra });
const answer = (id, questionId, jobId, materialIds, expressionIds) => ({ id, questionId, jobId, textEn, outlineZh: `中文结构 ${PRIVATE}`, wordCount: wordCount(textEn), materialIds, expressionIds, materialVersions: Object.fromEntries(materialIds.map(id => [id, 2])), materialSnapshots: materialIds.map(material), materialSpans: [], updatedAt: '2026-01-03T00:00:00Z' });
const review = (id, kind, targetId) => ({ id, kind, targetId, reviewCount: 1, dueAt: '2026-02-01T00:00:00Z' });

function fixture(t, { shared = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'yasy-first-use-cleanup-'));
  const file = join(directory, 'learning.sqlite'); const store = new Store({ file, bank });
  store.setSettings({ targetBand: '7.5', dailySpeaking: 3, provider: 'iiiapi' });
  const materials = shared ? ['m-only', 'm-shared', 'm-history', 'm-draft', 'm-job', 'm-independent'] : ['m-only'];
  const expressions = shared ? ['e-only', 'e-shared', 'e-history', 'e-draft', 'e-job', 'e-linked', 'e-independent'] : ['e-only'];
  materials.forEach(id => store.insert('materials', material(id))); expressions.forEach(id => store.insert('expressions', expression(id)));
  store.insert('jobs', job('later-first', 'q-first', '2026-01-02T00:00:00Z'));
  store.insert('jobs', job('earliest-first', 'q-first', '2026-01-01T00:00:00Z'));
  store.insert('answers', answer('answer-first', 'q-first', 'later-first', materials.filter(id => id !== 'm-independent'), expressions.filter(id => id !== 'e-independent')));
  store.insert('revisions', answer('revision-first', 'q-first', 'earliest-first', ['m-only'], ['e-only']));
  store.insert('drafts', { questionId: 'q-first', textZh: `首次草稿 ${PRIVATE}`, materialIds: ['m-only'] });
  store.insert('material_revisions', { id: 'history-only', materialId: 'm-only', version: 1, questionId: 'q-first', jobId: 'earliest-first', createdAt: '2026-01-02T00:00:00Z', snapshot: { ...material('m-only'), version: 1 } });
  store.link({ kind: 'material-question', fromId: 'm-only', toId: 'q-first', score: 1, reason: '首次题使用' });
  store.link({ kind: 'material-expression', fromId: 'm-only', toId: 'e-only', score: 1, reason: '首次题使用' });
  store.insert('words', { id: 'word-first', questionId: 'q-first', scope: 'speaking', textEn: 'confidence', meaningZh: '信心', exampleEn: textEn, createdAt: '2026-01-01T00:00:00Z' });
  store.insert('review_states', review('answer:answer-first', 'answer', 'answer-first'));
  store.insert('review_events', review('first-answer-event', 'answer', 'answer-first'));
  store.insert('review_states', review('word:word-first', 'word', 'word-first'));
  store.insert('review_events', review('first-word-event', 'word', 'word-first'));
  if (shared) {
    store.insert('jobs', job('other-complete', 'q-other', '2026-01-03T00:00:00Z'));
    store.insert('jobs', job('other-history', 'q-other', '2026-01-02T12:00:00Z'));
    store.insert('jobs', job('other-pending', 'q-job', '2026-01-04T00:00:00Z', { status: 'pending', materialIds: ['m-job'], expressionIds: ['e-job'] }));
    store.insert('answers', answer('answer-other', 'q-other', 'other-complete', ['m-shared'], ['e-shared']));
    store.insert('revisions', answer('revision-other', 'q-other', 'other-history', ['m-history'], ['e-history']));
    store.insert('drafts', { questionId: 'q-draft', textZh: `其他草稿 ${PRIVATE}`, materialIds: ['m-draft'], expressionIds: ['e-draft'] });
    store.insert('material_revisions', { id: 'history-shared', materialId: 'm-shared', version: 1, questionId: 'q-first', jobId: 'earliest-first', createdAt: '2026-01-02T00:00:00Z', snapshot: { ...material('m-shared'), version: 1 } });
    store.link({ kind: 'material-question', fromId: 'm-shared', toId: 'q-first', score: 1, reason: '首次题使用' });
    store.link({ kind: 'material-question', fromId: 'm-shared', toId: 'q-other', score: 1, reason: '其他题共享' });
    store.link({ kind: 'material-expression', fromId: 'm-shared', toId: 'e-shared', score: 1, reason: '共享表达' });
    store.link({ kind: 'material-expression', fromId: 'm-independent', toId: 'e-linked', score: 1, reason: '其他素材独立关联' });
    store.insert('words', { id: 'word-other', questionId: 'q-other', scope: 'speaking', textEn: 'practice', meaningZh: '练习', exampleEn: textEn, createdAt: '2026-01-03T00:00:00Z' });
    store.insert('words', { id: 'word-independent', scope: 'speaking', textEn: 'learn', meaningZh: '学习', exampleEn: textEn, createdAt: '2026-01-03T00:00:00Z' });
    store.insert('review_states', review('answer:answer-other', 'answer', 'answer-other'));
    store.insert('review_events', review('other-answer-event', 'answer', 'answer-other'));
    store.insert('review_states', review('word:word-other', 'word', 'word-other'));
    store.insert('review_events', review('other-word-event', 'word', 'word-other'));
  }
  store.setPlan(['q-first', 'q-other']); store.insert('plans', { date: '2026-01-01', questionIds: ['q-other', 'q-first', 'q-job'] });
  const original = store.backup(); store.close();
  const secretFile = join(directory, 'api-secrets.json'); writeFileSync(secretFile, JSON.stringify({ apiKey: KEY, model: 'mock-model' }), { mode: 0o600 });
  mkdirSync(join(directory, 'uploads')); writeFileSync(join(directory, 'uploads', 'untouched.pdf'), '%PDF-SYNTHETIC-UNCHANGED');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file, original, secretFile };
}

test('first cleanup targets creation time rather than insertion order and conservatively preserves shared learning', t => {
  const f = fixture(t); const before = structuredClone(f.original); const cleaned = clearFirstUseFromBackup(f.original);
  assert.deepEqual(f.original, before, 'the filter must not mutate its input'); assert.equal(cleaned.target.questionId, 'q-first');
  const learning = cleaned.backup.learning;
  assert.ok(['answers', 'revisions', 'drafts', 'jobs'].every(table => learning[table].every(item => item.questionId !== 'q-first')));
  assert.deepEqual(learning.materials.map(item => item.id), ['m-shared', 'm-history', 'm-draft', 'm-job', 'm-independent']);
  assert.deepEqual(learning.expressions.map(item => item.id), ['e-shared', 'e-history', 'e-draft', 'e-job', 'e-linked', 'e-independent']);
  assert.deepEqual(learning.material_revisions.map(item => item.id), ['history-shared']);
  assert.equal(learning.links.some(link => link.toId === 'q-first' || link.fromId === 'm-only' || link.toId === 'e-only'), false);
  assert.deepEqual(learning.review_states.map(item => item.targetId), ['answer-other', 'word-other']);
  assert.deepEqual(learning.review_events.map(item => item.targetId), ['answer-other', 'word-other']);
  assert.deepEqual(learning.words.map(item => item.id), ['word-other', 'word-independent']);
  assert.deepEqual(learning.plans.find(item => item.date === day()).questionIds, ['q-other']);
  assert.deepEqual(learning.plans.find(item => item.date === '2026-01-01').questionIds, ['q-other', 'q-job']);
  assert.deepEqual(cleaned.backup.bank, before.bank); assert.deepEqual(learning.settings, before.learning.settings);
  assert.deepEqual(learning.answers[0], before.learning.answers.find(item => item.questionId === 'q-other'));
  assert.deepEqual(learning.revisions[0], before.learning.revisions.find(item => item.questionId === 'q-other'));
  assert.equal(cleaned.removed.jobs, 2); assert.equal(cleaned.removed.planEntries, 2);
});

test('an independent first record removes its exclusive material, corpus, versions, reviews and words', t => {
  const f = fixture(t, { shared: false }); const cleaned = clearFirstUseFromBackup(f.original);
  for (const table of ['answers', 'revisions', 'drafts', 'jobs', 'materials', 'material_revisions', 'expressions', 'words', 'links', 'review_states', 'review_events']) assert.equal(cleaned.backup.learning[table].length, 0, table);
  assert.deepEqual(cleaned.backup.bank, f.original.bank); assert.equal(cleaned.backup.learning.settings.targetBand, '7.5');
});

test('default CLI is a true readonly preview and logs no private body or API configuration', t => {
  const f = fixture(t); const bytes = readFileSync(f.file); const secret = readFileSync(f.secretFile);
  const output = execFileSync(process.execPath, [script, '--db', f.file], { encoding: 'utf8' });
  assert.match(output, /q-first/); assert.match(output, /未修改数据库/); assert.equal(output.includes(PRIVATE), false); assert.equal(output.includes(KEY), false);
  assert.deepEqual(readFileSync(f.file), bytes); assert.deepEqual(readFileSync(f.secretFile), secret); assert.equal(existsSync(join(f.directory, 'backups')), false);
  assert.deepEqual(readLearningBackup(f.file).learning, f.original.learning);
});

test('apply saves a 600 complete backup and a UI before-restore snapshot; restoring recovers all learning', t => {
  const f = fixture(t); const logs = []; const secret = readFileSync(f.secretFile); const uploads = readFileSync(join(f.directory, 'uploads', 'untouched.pdf'));
  const applied = runFirstUseCleanup(['--db', f.file, '--apply', '--question-id', 'q-first'], value => logs.push(value));
  assert.equal(applied.applied, true); assert.equal(statSync(applied.backupPath).mode & 0o777, 0o600);
  assert.match(applied.backupPath, /before-first-use-cleanup-\d{8}-\d+\.json$/);
  const fileBackup = JSON.parse(readFileSync(applied.backupPath, 'utf8'));
  assert.deepEqual(fileBackup.bank, f.original.bank); assert.deepEqual(fileBackup.learning, f.original.learning);
  const reopened = new Store({ file: f.file, bank: f.original.bank });
  try {
    assert.deepEqual(reopened.backup().learning, applied.backup.learning);
    assert.deepEqual(reopened.previousBackup().learning, f.original.learning);
    reopened.restore(fileBackup);
    assert.deepEqual(reopened.backup().learning, f.original.learning); assert.deepEqual(reopened.backup().bank, f.original.bank);
  } finally { reopened.close(); }
  assert.deepEqual(readFileSync(f.secretFile), secret); assert.deepEqual(readFileSync(join(f.directory, 'uploads', 'untouched.pdf')), uploads);
  assert.equal(logs.join('\n').includes(PRIVATE), false); assert.equal(logs.join('\n').includes(KEY), false);
});

test('empty learning and a missing database are no-ops without creating backups or databases', t => {
  const directory = mkdtempSync(join(tmpdir(), 'yasy-first-use-empty-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'empty.sqlite'); const store = new Store({ file, bank }); const before = store.backup(); store.close();
  const pure = clearFirstUseFromBackup(before); assert.equal(pure.target, null); assert.deepEqual(pure.backup, before);
  const applied = runFirstUseCleanup(['--db', file, '--apply'], () => {}); assert.equal(applied.applied, false); assert.equal(existsSync(join(directory, 'backups')), false);
  assert.deepEqual(readLearningBackup(file).learning, before.learning);
  const missing = join(directory, 'not-created', 'learning.sqlite'); assert.equal(runFirstUseCleanup(['--db', missing, '--apply'], () => {}).applied, false); assert.equal(existsSync(join(directory, 'not-created')), false);
});

test('a changed target or ongoing background work blocks apply before any cleanup backup is created', t => {
  const f = fixture(t); const before = readLearningBackup(f.file);
  assert.throws(() => clearFirstUseFromBackup(before, { expectedQuestionId: 'q-other' }), error => error.status === 409);
  assert.throws(() => runFirstUseCleanup(['--db', f.file, '--apply', '--question-id', 'q-other'], () => {}));
  assert.equal(existsSync(join(f.directory, 'backups')), false);
  const store = new Store({ file: f.file, bank: f.original.bank }); const current = store.get('jobs', 'other-pending'); store.insert('jobs', { ...current, status: 'processing' }); store.close();
  const busyBefore = readLearningBackup(f.file);
  assert.throws(() => runFirstUseCleanup(['--db', f.file, '--apply'], () => {}), /Processing/);
  assert.deepEqual(readLearningBackup(f.file).learning, busyBefore.learning); assert.equal(existsSync(join(f.directory, 'backups')), false);
});
