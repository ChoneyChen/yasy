import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { buildPrompt as buildDesktopPrompt } from '../server/prompts.mjs';
import { checkQuality as checkDesktopQuality } from '../server/domain.mjs';
import { buildIOSPrompt, buildIOSIdeaPrompt, checkIOSQuality, IOS_PROMPT_VERSION, answerSystem, ideaSystem } from '../src/mobileLocal/prompts.mjs';
import { draftIOSIdea } from '../src/mobileLocal/ideas.mjs';

const q = (scope = 'speaking', part = 'Part 1') => ({ id: `q-${scope}`, scope, part, promptEn: scope === 'speaking' ? 'Do you enjoy walking?' : 'Should cities spend more money on public transport?', promptZh: '测试题目', cuePoints: [], tags: ['transport'] });
const input = (question = q()) => ({ question, requestId: 'job-ios-prompt', draftZh: '我喜欢散步，因为它能让我放松。' });
const learning = prompt => JSON.parse(prompt.split('\n【本次学习数据 JSON】\n')[1]);
let vite, localProvider, createLocalStore, createLocalRouter;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ localProvider } = await vite.ssrLoadModule('/src/mobileLocal/ai.mjs'));
  ({ createLocalStore } = await vite.ssrLoadModule('/src/mobileLocal/store.mjs'));
  ({ createLocalRouter } = await vite.ssrLoadModule('/src/mobileLocal/router.mjs'));
});
after(async () => { await vite?.close(); });

test('iPhone prompting develops the base into a task-centred answer without changing the desktop prompt or gate', () => {
  const data = input(q('writing-task2'));
  const desktopBefore = buildDesktopPrompt(data);
  const phone = buildIOSPrompt(data);
  assert.match(phone, /先抓题干真正问的对象/);
  assert.match(phone, /允许大幅重组/);
  assert.match(phone, /主动发展与之相容的机制/);
  assert.match(phone, /不得按中文逐句翻译、逐段对应/);
  assert.match(phone, /不要求第二轮审核或新调用/);
  assert.match(phone, /不得编造调查、研究、名言/);
  assert.equal(buildDesktopPrompt(data), desktopBefore);
  assert.doesNotMatch(desktopBefore, /iPhone 版 Yasy/);
  assert.equal(checkDesktopQuality(data.question, '公共交通更公平').passed, false);
  assert.equal(checkIOSQuality(data.question, '公共交通更公平').passed, true);
});

test('the current speaking part receives its own answer strategy and practice length', () => {
  for (const [part, range, strategy] of [
    ['Part 1', '35—80词', '一处真实小细节'],
    ['Part 2', '170—260词', '全部 cuePoints'],
    ['Part 3', '70—130词', '主动发展抽象讨论'],
  ]) {
    const value = buildIOSPrompt(input(q('speaking', part)));
    assert.ok(value.includes(range));
    assert.ok(value.includes(strategy));
    assert.match(value, /绝非 IELTS 官方词数门槛/);
    assert.match(value, /文字只能支持内容、词汇、语法与连贯训练/);
    for (const otherRange of ['35—80词', '170—260词', '70—130词'].filter(other => other !== range)) assert.ok(!value.includes(otherRange));
  }
  const value = buildIOSPrompt(input({ ...q('speaking', 'Part 2'), taskType: 'follow-up' }));
  assert.match(value, /20—50词/);
  assert.match(value, /不重新讲完整题卡故事/);
  assert.ok(!value.includes('170—260词'));
});

test('Academic Task 1 builds the overview and grouped comparison from actual chart data, without stories', () => {
  const question = { ...q('writing-task1'), visual: { kind: 'table', title: 'Trips', columns: ['Year', 'Trips'], rows: [[2020, 10], [2025, 20]], steps: [], note: 'Trips in millions.' } };
  const value = buildIOSPrompt({ ...input(question), draftZh: '', selectedMaterials: [{ id: 'private-story', scope: 'speaking' }], candidates: [{ ...question, id: 'private-other' }] });
  assert.match(value, /至少150词是官方要求/);
  assert.match(value, /练习目标160—210词/);
  assert.match(value, /自行选择主要特征/);
  assert.match(value, /materials=\[\]，recommendations=\[\]，answer.materialSpans=\[\]/);
  assert.match(value, /禁止虚构数值、趋势、原因/);
  assert.deepEqual(learning(value).question.visual, question.visual);
  assert.deepEqual(learning(value).selectedMaterials, []);
  assert.deepEqual(learning(value).candidates, []);
  assert.ok(!value.includes('private-story'));
  assert.ok(!value.includes('private-other'));
});

test('Academic Task 2 distinguishes real task demands and develops supported paragraphs', () => {
  const value = buildIOSPrompt(input(q('writing-task2')));
  assert.match(value, /至少250词是官方要求/);
  assert.match(value, /练习目标260—320词/);
  assert.match(value, /outweigh 题比较两方重要性后判断/);
  assert.match(value, /双问题题两个问题均展开/);
  assert.match(value, /为什么\/如何→相关支撑/);
  assert.match(value, /不得改变明确的核心立场/);
  assert.match(value, /避免口语缩写/);
});

test('the phone result keeps bilingual material identity, exact answer spans, selective corpus and bound candidate IDs', () => {
  const selected = [{ id: 'm-existing', scope: 'speaking', version: 4, title: 'Walking', summaryZh: '散步放松', summaryEn: 'Walking to relax', detailZh: '我喜欢散步，因为能放松。', detailEn: 'I enjoy walking because it helps me relax.', tags: ['walking'] }];
  const data = { ...input(), selectedMaterials: selected, candidates: [{ ...q(), id: 'candidate-q' }, { ...q('writing-task2'), id: 'wrong-library' }, q()] };
  const before = structuredClone(data);
  const value = buildIOSPrompt(data), decoded = learning(value);
  assert.deepEqual(data, before);
  assert.deepEqual(decoded.selectedMaterials, selected);
  assert.deepEqual(decoded.candidates.map(c => c.id), ['candidate-q']);
  assert.match(value, /同一完整内核的双语内容/);
  assert.match(value, /保留所有旧确认事实/);
  assert.match(value, /quote 是最终答案中唯一出现、逐字相同/);
  assert.match(value, /每个输出素材都要有对应标注/);
  assert.match(value, /允许 expressions=\[\]/);
  assert.match(value, /每素材仅连最相关的3条语料/);
  assert.match(value, /不得创造 ID/);
});

test('phone preflight permits a brief Chinese base and empty notes with usable visuals, without accepting empty or English-only ideas', () => {
  assert.equal(checkIOSQuality(q(), '喜欢散步，放松').passed, true);
  assert.equal(checkIOSQuality(q(), '').passed, false);
  assert.equal(checkIOSQuality(q(), 'I like walking').passed, false);
  assert.equal(checkIOSQuality({ ...q('writing-task1'), visual: { kind: 'table', rows: [[2020, 10]] } }, '').passed, true);
  assert.equal(checkIOSQuality({ ...q('writing-task1'), visual: { kind: 'process', steps: ['Collect', 'Process'] } }, '').passed, true);
  assert.equal(checkIOSQuality({ ...q('writing-task1'), visual: { kind: 'map', note: 'The library is west of the park.' } }, '').passed, true);
  assert.equal(checkIOSQuality({ ...q('writing-task1'), visual: { kind: 'table', rows: [], note: '' } }, '').passed, false);
  assert.throws(() => checkIOSQuality(q(), '中'.repeat(20001)), /过长/);
});

test('the native phone provider sends one authoring call with the full contract and does not retry incomplete output', async () => {
  const calls = [];
  let truncated = false;
  const provider = await localProvider(async (action, body) => {
    calls.push({ action, body });
    if (action === 'ai.config.get') return { configured: true, hasKey: true, model: 'fixture-model' };
    assert.equal(action, 'ai.completions');
    return { model: 'fixture-model', choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: '{"result":"fixture"}' } }] };
  });
  const prepared = provider.prepare(input());
  assert.equal(prepared.requiresUserSubmission, false);
  await provider.generate({ prompt: prepared.prompt });
  assert.equal(calls.filter(c => c.action === 'ai.completions').length, 1);
  assert.equal(calls[1].body.messages[0].content, answerSystem);
  assert.equal(calls[1].body.messages[1].content, prepared.prompt);
  assert.equal(calls[1].body.stream, false);
  assert.ok(!JSON.stringify(calls[1].body).includes('native-keychain-capability'));
  truncated = true;
  await assert.rejects(provider.generate({ prompt: prepared.prompt }), /未返回完整答案/);
  assert.equal(calls.filter(c => c.action === 'ai.completions').length, 2);
});

test('Chinese idea help is a single independent preview with concise notes and no learning writes', async () => {
  let calls = 0;
  const question = q();
  const provider = {
    config: { public: () => ({ configured: true }), secret: () => ({ apiKey: 'fixture-capability', model: 'fixture-model' }), redact: message => message },
    request: async (path, { body }) => {
      calls++;
      assert.equal(path, '/chat/completions');
      assert.equal(body.messages[0].content, ideaSystem);
      assert.match(body.messages[1].content, /不能只是原句换词或复述/);
      assert.match(body.messages[1].content, /0—3条简短必要提醒/);
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questionId: question.id, origin: 'refined', draftZh: '我喜欢散步，因为这让我有机会放慢节奏，暂时从日常事务中抽离。', notes: [], requiresConfirmation: true }) } }] };
    },
    generate: () => assert.fail('Idea help cannot call answer generation'),
  };
  const store = { question: id => { assert.equal(id, question.id); return question; } };
  const result = await draftIOSIdea(store, provider, { questionId: question.id, textZh: '我喜欢散步，放松。' });
  assert.equal(calls, 1);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.origin, 'refined');
  assert.deepEqual(result.notes, []);
  const generated = buildIOSIdeaPrompt({ question });
  assert.match(generated, /构思示例，尚未确认为我的真实经历/);
  assert.match(generated, /只写中文，不写英文句子/);
});

test('phone routing accepts a short base and upgrades restored pending prompts before exactly one formal call', async t => {
  const question = { ...q(), topicId: 'topic', sourceId: 'source', sourceType: 'adapted' };
  const runtime = await createLocalStore({ bank: { sources: [{ id: 'source', title: 'Fixture', type: 'official', url: 'https://ielts.org/' }], topics: [{ id: 'topic', scope: 'speaking', titleZh: '散步', titleEn: 'Walking', tags: [] }], questions: [question] } });
  t.after(() => runtime.store.close());
  const entered = [];
  const provider = { config: { public: () => ({ configured: true }), secret: () => ({ model: 'fixture-model' }), redact: String }, generate: async job => {
    entered.push(job);
    return { model: 'fixture-model', result: { requestId: job.id, questionId: job.questionId, scope: job.scope, quality: { passed: false, suggestions: ['测试模型返回一条必要事实补充建议。'] }, answer: { textEn: '', outlineZh: '', materialSpans: [] }, materials: [], expressions: [], recommendations: [] } };
  } };
  const route = await createLocalRouter({ runtime, providerFactory: async () => provider });
  const legacyStates = [
    { status: 'pending', contractVersion: 1, promptVersion: undefined },
    { status: 'failed', contractVersion: undefined, promptVersion: undefined },
    { status: 'pending', contractVersion: 1, promptVersion: IOS_PROMPT_VERSION },
  ];
  for (const [index, legacy] of legacyStates.entries()) {
    const created = await route('/api/jobs', { method: 'POST', body: JSON.stringify({ questionId: question.id, textZh: '喜欢散步，放松', materialIds: [] }) });
    assert.equal(created.status, 200);
    const { job } = await created.json();
    assert.equal(job.promptVersion, IOS_PROMPT_VERSION);
    assert.match(job.prompt, /不得按中文逐句翻译/);
    runtime.store.insert('jobs', { ...job, ...legacy, prompt: legacy.promptVersion ? job.prompt : 'An old translation prompt restored from an earlier build.' });
    const generated = await route(`/api/jobs/${job.id}/generate`, { method: 'POST', body: '{}' });
    assert.equal(generated.status, 200);
    assert.equal(entered.length, index + 1, 'Each legacy job makes exactly one formal call');
    assert.equal(entered[index].promptVersion, IOS_PROMPT_VERSION);
    assert.equal(entered[index].contractVersion, 2, 'Legacy/missing contracts must use the current length gate');
    assert.match(entered[index].prompt, /从 base 创作答案/);
    assert.doesNotMatch(entered[index].prompt, /An old translation prompt/);
    assert.equal(learning(entered[index].prompt).draftZh, '喜欢散步，放松');
    assert.equal(runtime.store.get('jobs', job.id).status, 'needs-revision');
    assert.equal(runtime.store.get('jobs', job.id).contractVersion, 2);
  }
});
