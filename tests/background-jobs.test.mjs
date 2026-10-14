import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobTracker, mergeJob, latestQuestionJob, isApprovedExpression, expressionStatus } from '../src/backgroundJobs.mjs';
const job = (status, extra = {}) => ({ id: 'job-a', questionId: 'question-a', createdAt: '2026-10-14T00:00:00Z', startedAt: '2026-10-14T00:00:01Z', runId: 'run-a', status, ...extra });
test('restored active background work notifies completion once without replaying old completed tasks', () => {
  const first = createJobTracker(); assert.deepEqual(first.observe([job('processing'), job('completed', { id: 'old' })]), []);
  const restored = createJobTracker(first.serialize()); assert.equal(restored.observe([job('completed')]).length, 1); assert.deepEqual(restored.observe([job('completed')]), []);
});
test('a delayed accepted response cannot move the same completed run back to processing', () => {
  const completed = job('completed', { finishedAt: '2026-10-14T00:00:05Z' }); assert.deepEqual(mergeJob([completed], job('processing')), [completed]);
});
test('failure followed by a new run is tracked independently and other question jobs are preserved', () => {
  const tracker = createJobTracker(); tracker.observe([job('processing')]); assert.equal(tracker.observe([job('failed')]).length, 1);
  const second = job('processing', { runId: 'run-b', startedAt: '2026-10-14T00:00:09Z' }); tracker.observe([second]); assert.equal(tracker.observe([{ ...second, status: 'completed' }]).length, 1);
  const other = job('processing', { id: 'job-b', questionId: 'question-b' }); assert.equal(mergeJob([job('failed'), other], second).length, 2); assert.equal(latestQuestionJob([second, other], 'question-b').id, 'job-b');
});
test('unreviewed and rejected expressions never enter the normal corpus', () => {
  assert.equal(expressionStatus({}), 'pending'); assert.equal(isApprovedExpression({}), false); assert.equal(isApprovedExpression({ admission: { status: 'rejected' } }), false); assert.equal(isApprovedExpression({ admission: { status: 'approved' } }), true);
});
test('a task finishing before its acceptance response is still reported, including revision feedback', () => {
  const tracker = createJobTracker(); tracker.observe([]); tracker.observe([job('pending', { runId: undefined, startedAt: undefined })]);
  const needsRevision = job('needs-revision', { quality: { suggestions: ['补充一个具体细节'] } });
  assert.deepEqual(tracker.observe([needsRevision]), [needsRevision]);
  assert.deepEqual(tracker.observe([job('processing')]), []);
  assert.deepEqual(tracker.observe([needsRevision]), []);
});
test('an old retry acknowledgement cannot replace a newer run or another question draft snapshot', () => {
  const newer = job('processing', { runId: 'run-new', startedAt: '2026-10-14T00:00:12Z' });
  const other = job('processing', { id: 'job-b', questionId: 'question-b' });
  const current = { jobs: [newer, other], drafts: [{ questionId: 'question-b', textZh: '正在写的新素材' }], selectedQuestion: 'question-b' };
  const updated = { ...current, jobs: mergeJob(current.jobs, job('processing')) };
  assert.deepEqual(updated.jobs, current.jobs); assert.equal(updated.drafts, current.drafts); assert.equal(updated.selectedQuestion, 'question-b');
});
