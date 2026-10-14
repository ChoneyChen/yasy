import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessExpression, auditExpressions, corpusPolicyVersion } from '../server/corpus.mjs';

function expression(textEn = 'strike a balance', scope = 'speaking', benefit = 'collocation') {
  return {
    textEn, scope, categoryEn: 'Reusable collocation',
    usageNoteEn: 'Use this expression to discuss competing needs and practical choices.',
    admission: {
      approved: true, benefit,
      reasonZh: '这一搭配能准确表达兼顾不同需求，可迁移到新的话题。',
      reasonEn: 'This collocation precisely describes managing competing needs across different topics.',
      transferExampleEn: `A small organisation can ${textEn} when setting its priorities.`,
    },
  };
}
const assess = (item, answerText = `We can ${item.textEn} when studying together.`, scope = item.scope) => assessExpression(item, { scope, answerText });

test('useful two- and three-word expressions remain eligible in speaking and writing', () => {
  for (const quote of ['strike a balance', 'build confidence', 'draw a distinction']) {
    for (const scope of ['speaking', 'writing-task2']) {
      const result = assess(expression(quote, scope));
      assert.equal(result.status, 'approved', `${scope}: ${quote}`);
      assert.equal(result.policyVersion, 2);
    }
  }
});

test('single words belong to the wordbook, while a hyphenated expression is not collapsed into one word', () => {
  assert.equal(assess(expression('good')).status, 'rejected');
  assert.equal(assess(expression('confidence')).status, 'rejected');
  assert.equal(assess(expression('eye-opening')).status, 'approved');
});

test('model approval cannot rescue basic stock phrases or trivial intensifiers', () => {
  for (const quote of ['I think', 'very good', 'a lot of', 'for example', 'in conclusion', '  FOR   EXAMPLE!  ', 'really nice']) {
    assert.equal(assess(expression(quote)).status, 'rejected', quote);
  }
  assert.equal(assess(expression('deeply concerned')).status, 'approved');
});

test('a model rejection retains its stated reasons even with missing positive fields', () => {
  const result = assessExpression({ textEn: 'build confidence', admission: { approved: false, reasonZh: '此处用法不准确。', reasonEn: 'The collocation is inaccurate in this context.' } });
  assert.deepEqual(result, { status: 'rejected', reasonZh: '此处用法不准确。', reasonEn: 'The collocation is inaccurate in this context.', policyVersion: 2 });
});

test('model rejection supplies readable fallback reasons when its explanations are empty', () => {
  const result = assessExpression({ admission: { approved: false } });
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasonZh && result.reasonEn);
});

test('only continuous answer quotes qualify; case differences are supported', () => {
  const item = expression('build confidence');
  assert.equal(assess(item, 'These activities help people BUILD CONFIDENCE.').status, 'approved');
  assert.equal(assess(item, 'These activities develop confidence.').status, 'rejected');
  assert.equal(assess(item, 'These activities build much greater confidence.').status, 'rejected');
  assert.equal(assess(item, 'These activities build  confidence.').status, 'rejected');
});

test('a string found only inside another word does not count as a quote', () => {
  const item = expression('at ease');
  assert.equal(assess(item, 'We discussed great ease of access.').status, 'rejected');
  assert.equal(assess(item, 'We felt at ease after meeting the team.').status, 'approved');
});

test('conversational idioms cannot enter either Academic writing corpus', () => {
  for (const scope of ['writing-task1', 'writing-task2']) {
    for (const quote of ['over the moon', 'a piece of cake', 'once in a blue moon']) assert.equal(assess(expression(quote, scope, 'idiomatic')).status, 'rejected');
  }
  assert.equal(assess(expression('over the moon', 'speaking', 'idiomatic')).status, 'approved');
});

test('explicitly informal usage guidance is incompatible with writing', () => {
  const item = expression('build confidence', 'writing-task2');
  item.usageNoteEn = 'This is an informal phrase for casual conversations.';
  assert.equal(assess(item).status, 'rejected');
});

test('Task 1 accepts descriptive language but rejects Task 2 stance structures', () => {
  assert.equal(assess(expression('a marked increase', 'writing-task1', 'precision'), 'The graph shows a marked increase in sales.').status, 'approved');
  const quote = 'there is a compelling case for';
  assert.equal(assess(expression(quote, 'writing-task1', 'structure')).status, 'rejected');
  assert.equal(assess(expression(quote, 'writing-task2', 'structure')).status, 'approved');
});

test('a scope mismatch and an unsupported scope cannot be approved', () => {
  const item = expression();
  assert.equal(assess(item, 'We can strike a balance.', 'writing-task2').status, 'rejected');
  assert.equal(assess(item, 'We can strike a balance.', 'writing').status, 'rejected');
});

test('approval without source answer or learning scope remains pending', () => {
  const item = expression();
  assert.equal(assessExpression(item, { scope: 'speaking' }).status, 'pending');
  delete item.scope;
  assert.equal(assessExpression(item, { answerText: 'We can strike a balance.' }).status, 'pending');
});

test('benefit must use a supported learning-purpose classification', () => {
  const item = expression();
  item.admission.benefit = 'sounds-advanced';
  assert.equal(assess(item).status, 'rejected');
  for (const benefit of ['collocation', 'idiomatic', 'precision', 'structure', 'discourse']) assert.equal(assess(expression('build confidence', 'speaking', benefit)).status, 'approved');
});

test('missing bilingual reasons or vague praise cannot establish admission', () => {
  for (const [field, value] of [['reasonZh', ''], ['reasonEn', ' '], ['reasonEn', 'Useful'], ['reasonZh', '高级表达'], ['reasonEn', '这是一条有用语料。']]) {
    const item = expression(); item.admission[field] = value;
    assert.equal(assess(item).status, 'rejected', field + value);
  }
});

test('approval requires a meaningful English usage note and transfer example', () => {
  for (const value of ['', 'useful', '这是用于比较的表达。']) {
    const item = expression(); item.usageNoteEn = value;
    assert.equal(assess(item).status, 'rejected');
  }
  for (const value of ['', 'Useful expression', 'strike a balance', '在这里举例。']) {
    const item = expression(); item.admission.transferExampleEn = value;
    assert.equal(assess(item).status, 'rejected');
  }
});

test('transfer examples may adapt tense and sentence slots rather than copy the quote literally', () => {
  const item = expression('built confidence');
  item.admission.transferExampleEn = 'Regular practice helps shy speakers build confidence.';
  assert.equal(assess(item, 'The group activity built confidence.').status, 'approved');
});

test('an invalid or truthy approval value cannot be mistaken for approval', () => {
  for (const value of ['true', 1, {}, []]) {
    const item = expression(); item.admission.approved = value;
    assert.equal(assess(item).status, 'rejected');
  }
  const item = expression(); item.admission = [];
  assert.equal(assess(item).status, 'rejected');
});

test('legacy records receive narrow local rejections but no automatic semantic approval', () => {
  for (const quote of ['good', 'very good', 'I think']) assert.equal(assessExpression({ textEn: quote, scope: 'speaking' }).status, 'rejected');
  const useful = { textEn: 'build confidence', scope: 'speaking', exampleEn: 'Practice can build confidence.' };
  const result = assessExpression(useful, { answerText: 'Practice can build confidence.' });
  assert.equal(result.status, 'pending');
  assert.match(result.reasonZh, /历史语料/);
  assert.equal(assessExpression({ ...useful, admission: null }).status, 'pending');
  assert.equal(assessExpression({ textEn: 'over the moon', scope: 'writing-task2' }).status, 'rejected');
});

test('audit preserves every record and refusal reason without mutating private data', () => {
  const items = [{ id: 'basic', textEn: 'for example', scope: 'speaking', links: ['material-1'] }, { id: 'legacy', textEn: 'draw a distinction', scope: 'writing-task2' }, { id: 'new', ...expression('build confidence') }];
  const before = structuredClone(items);
  const result = auditExpressions(items, { contextFor: item => ({ scope: item.scope, answerText: `We can ${item.textEn} in another setting.` }) });
  assert.deepEqual(items, before);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.counts, { approved: 1, rejected: 1, pending: 1 });
  assert.equal(result.items[0].expression, items[0]);
  assert.deepEqual(result.items[0].expression.links, ['material-1']);
  assert.ok(result.items.every(row => row.assessment.reasonZh && row.assessment.reasonEn));
  assert.equal(result.policyVersion, 2);
  assert.equal(corpusPolicyVersion, 2);
});

test('invalid input is assessed safely while a malformed audit batch is a caller error', () => {
  for (const item of [null, undefined, [], 'build confidence', {}, { textEn: '建立信心' }]) assert.equal(assessExpression(item).status, 'rejected');
  assert.throws(() => auditExpressions({}), TypeError);
});
