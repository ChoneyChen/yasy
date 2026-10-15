import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSnapshotGate } from '../src/snapshotGate.mjs';

let server;
let recommendationRevision, apiAvailable, jobRequest, practicePath, practiceEmptyCopy, clientPolicy, Today, Workspace;
before(async () => {
  // Load the actual TSX exports without mounting the app or contacting an API.
  server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
  ({ recommendationRevision, apiAvailable, jobRequest, practicePath, practiceEmptyCopy, clientPolicy, Today, Workspace } = await server.ssrLoadModule('/src/App.tsx'));
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

test('the Today entry renders only speaking and writing choices without plans, counts or recent content', () => {
  const html = renderToStaticMarkup(createElement(Today, { start: () => {}, busy: false }));
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.match(html, /口语积累/); assert.match(html, /作文积累/);
  assert.doesNotMatch(html, /今日任务|安排|计划|已整理答案|近期|最近的积累|stats-grid|welcome-card/);
});
test('practice requests bind sequential switching and random continuation to the visible current question', () => {
  assert.equal(practicePath('speaking', 'first'), '/practice/next?kind=speaking&mode=first');
  assert.equal(practicePath('writing', 'switch', 'q-a'), '/practice/next?kind=writing&mode=switch&currentId=q-a');
  assert.equal(practicePath('speaking', 'random', 'q-a'), '/practice/next?kind=speaking&mode=random&currentId=q-a');
  assert.notEqual(practiceEmptyCopy('speaking', 'processing').title, practiceEmptyCopy('speaking', 'all-completed').title);
  assert.match(practiceEmptyCopy('writing', 'no-questions').detail, /作文区/);
});
const workspaceFixture = (completed = false) => {
  const q = { ...question, titleZh: '独特的当前题', sourceId: 'test-source', sourceType: 'adapted', part: 'Part 1' };
  const bank = { questions: [q, { ...q, id: 'q-b', promptEn: 'A different question that must not render.' }], archivedQuestions: [], sources: [], topics: [], materials: [], expressions: [], links: [], drafts: [], jobs: [], words: [], settings: { provider: 'iiiapi', targetBand: '7.0' }, answers: completed ? [{ id: 'answer-a', questionId: q.id, textEn: 'This is my saved answer.', wordCount: 5, materialIds: [], expressionIds: [], jobId: 'job-a' }] : [] };
  return { question: q, prefill: [], state: bank, reload: async () => bank, notify: () => {}, goBack: () => {}, openQuestion: () => {}, addWord: () => {}, onMaterial: () => {}, onExpression: () => {}, aiConfig: { provider: 'iiiapi', hasKey: true, model: 'fixture-model' }, registerJob: () => {}, runBackground: async () => {}, questionBusy: false, apiMode: true, iosClient: false, practice: { kind: 'speaking', busy: false, next: async () => {} }, onSettings: () => {} };
};
test('practice uses the same single-question editor while removing every task-plan control', () => {
  const html = renderToStaticMarkup(createElement(Workspace, workspaceFixture()));
  assert.match(html, /返回今日积累/); assert.match(html, /换道题/); assert.match(html, /帮我想素材/);
  assert.match(html, /Describe a trip\./); assert.doesNotMatch(html, /A different question that must not render\./);
  assert.doesNotMatch(html, /今日任务|加入今日|安排任务|选题数量/);
});
test('a completed practice answer offers the next unanswered question instead of the direct-library next button', () => {
  const html = renderToStaticMarkup(createElement(Workspace, workspaceFixture(true)));
  assert.match(html, /This is my saved answer\./); assert.match(html, /下一道未积累题/);
  assert.doesNotMatch(html, /下一道题<|今日任务|复制提示词并打开/);
});
test('native iOS stays API-only at iPad width, while narrow Mac still retains local pairing administration', () => {
  assert.deepEqual(clientPolicy('?client=ios', false), { nativeIOSClient: true, iosClient: true });
  assert.deepEqual(clientPolicy('', true), { nativeIOSClient: false, iosClient: true });
  assert.deepEqual(clientPolicy('', false), { nativeIOSClient: false, iosClient: false });
});
