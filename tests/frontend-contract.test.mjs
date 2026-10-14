import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createSnapshotGate } from '../src/snapshotGate.mjs';

let server;
let recommendationRevision, apiAvailable, jobRequest;
before(async () => {
  // Load the actual TSX exports without mounting the app or contacting an API.
  server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
  ({ recommendationRevision, apiAvailable, jobRequest } = await server.ssrLoadModule('/src/App.tsx'));
});
after(async () => { await server?.close(); });
const question = { id: 'q-a', scope: 'speaking', topicId: 'topic-a', promptEn: 'Describe a trip.', promptZh: '描述一次旅行', tags: ['trip'] };
const material = { id: 'm-a', scope: 'speaking', version: 1, updatedAt: '2026-10-14T00:00:00Z', createdAt: '2026-10-13T00:00:00Z', title: '旅行', summaryZh: '第一次旅行', detailZh: '骑车旅行', tags: ['trip'] };
const expression = { id: 'e-a', scope: 'speaking', textEn: 'off the beaten track', meaningZh: '偏僻的', exampleEn: 'We went off the beaten track.', category: 'description', usageNote: '自然描述', tags: ['trip'], admission: { status: 'pending', policyVersion: 2 } };
const state = () => ({ materials: [{ ...material }], expressions: [{ ...expression }], links: [] });

test('recommendations refresh when the same material ID gains a version, timestamp or corrected content', () => {
  const before = recommendationRevision(question, state());
  for (const patch of [{ version: 2 }, { updatedAt: '2026-10-14T00:05:00Z' }, { detailZh: '新补充的真实细节' }]) {
    const updated = state(); Object.assign(updated.materials[0], patch);
    assert.notEqual(recommendationRevision(question, updated), before);
  }
});
test('same-count admission changes and new recommendation links invalidate the signature', () => {
  const before = recommendationRevision(question, state());
  const approved = state(); approved.expressions[0].admission = { ...approved.expressions[0].admission, status: 'approved' };
  assert.notEqual(recommendationRevision(question, approved), before);
  const linked = state(); linked.links = [{ kind: 'material-question', fromId: 'm-a', toId: question.id, score: .9, reason: '与本题相关' }];
  assert.notEqual(recommendationRevision(question, linked), before);
});
test('equivalent polling snapshots, reordered records and unrelated libraries keep the same signature', () => {
  const initial = state(); initial.materials.push({ ...material, id: 'm-b' });
  const reversed = structuredClone(initial); reversed.materials.reverse();
  assert.equal(recommendationRevision(question, reversed), recommendationRevision(question, initial));
  reversed.materials.push({ ...material, id: 'writing-a', scope: 'writing-task2', version: 20 });
  reversed.expressions.push({ ...expression, id: 'writing-e', scope: 'writing-task2', admission: { status: 'approved' } });
  reversed.words = [{ textEn: 'an unrelated word' }]; reversed.drafts = [{ textZh: 'another question draft' }];
  assert.equal(recommendationRevision(question, reversed), recommendationRevision(question, initial));
});
test('a delayed old recommendation response cannot replace the newly fetched material version', () => {
  const gate = createSnapshotGate(); const old = gate.begin(); gate.invalidate(); const latest = gate.begin();
  let recommendations = [];
  assert.equal(gate.apply(latest, () => { recommendations = [{ id: 'm-a', version: 2 }]; }), true);
  assert.equal(gate.apply(old, () => { recommendations = [{ id: 'm-a', version: 1 }]; }), false);
  assert.equal(recommendations[0].version, 2);
});
test('iOS API availability and job binding remain independent of the Mac web preference', () => {
  const config = { provider: 'web-bridge', hasKey: true, model: 'selected-model' };
  assert.equal(apiAvailable(config, true), true); assert.equal(apiAvailable(config, false), false);
  assert.equal(apiAvailable({ ...config, hasKey: false }, true), false); assert.equal(apiAvailable({ ...config, model: '' }, true), false);
  assert.deepEqual(jobRequest('q-a', '粗略想法', ['m-a'], true), { questionId: 'q-a', textZh: '粗略想法', materialIds: ['m-a'], client: 'ios' });
  assert.deepEqual(jobRequest('q-a', '粗略想法', [], false), { questionId: 'q-a', textZh: '粗略想法', materialIds: [] });
});
