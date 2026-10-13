import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotGate } from '../src/snapshotGate.mjs';

test('a processing GET returning after successful generation cannot hide the saved answer', () => {
  const gate = createSnapshotGate();
  let view = { status: 'processing', answers: [] };
  const oldRead = gate.begin();
  gate.invalidate();
  view = { status: 'completed', answers: ['my saved answer'] };
  const accepted = gate.apply(oldRead, () => { view = { status: 'processing', answers: [] }; });
  assert.equal(accepted, false);
  assert.deepEqual(view, { status: 'completed', answers: ['my saved answer'] });
});

test('out-of-order polling results cannot move a completed local job back to processing', () => {
  const gate = createSnapshotGate();
  let view = 'processing';
  let localJob = 'processing';
  const earlierPoll = gate.begin();
  const laterPoll = gate.begin();
  assert.equal(gate.apply(laterPoll, () => { view = 'completed'; localJob = 'completed'; }), true);
  assert.equal(gate.apply(earlierPoll, () => { view = 'processing'; localJob = 'processing'; }), false);
  assert.equal(view, 'completed');
  assert.equal(localJob, 'completed');
});

test('navigation invalidates a departing workspace read before it mutates global cached state', () => {
  const gate = createSnapshotGate();
  const departingRead = gate.begin();
  let view = 'wordbook';
  let workspaceCallbackCalled = false;
  gate.invalidate();
  assert.equal(gate.apply(departingRead, () => { view = 'old workspace'; workspaceCallbackCalled = true; }), false);
  assert.equal(view, 'wordbook');
  assert.equal(workspaceCallbackCalled, false);
});

test('a fresh snapshot after a write remains usable while all previous requests stay invalid', () => {
  const gate = createSnapshotGate();
  const beforeWrite = gate.begin();
  gate.invalidate();
  const afterWrite = gate.begin();
  let visibleWords = [];
  assert.equal(gate.apply(afterWrite, () => { visibleWords = ['confidence']; }), true);
  assert.equal(gate.apply(beforeWrite, () => { visibleWords = []; }), false);
  assert.deepEqual(visibleWords, ['confidence']);
});
