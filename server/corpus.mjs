/**
 * Corpus admission is a learning-library gate, not an IELTS score or a complete
 * semantic review. All functions are pure: rejected/pending records stay intact.
 */
export const corpusPolicyVersion = 2;
export const expressionBenefits = Object.freeze(['collocation', 'idiomatic', 'precision', 'structure', 'discourse']);

const scopes = new Set(['speaking', 'writing-task1', 'writing-task2']);
// Deliberately small. Length alone must not reject useful short collocations.
const basicPhrases = new Set([
  'i think', 'i believe', 'in my opinion', 'a lot of', 'lots of',
  'for example', 'for instance', 'in conclusion', 'to sum up', 'first of all',
  'last but not least', 'you know', 'very much', 'in general',
]);
const basicIntensifier = /^(?:very|really|so|quite)\s+(?:good|bad|nice|great|happy|sad|important|useful)$/;
// These are conventional conversational idioms; do not blacklist shared formal
// collocations such as "strike a balance" or "draw a distinction".
const conversational = /\b(?:over the moon|on cloud nine|a piece of cake|hit the sack|spill the beans|once in a blue moon|kick back|hang out|get the hang of|cost an arm and a leg|gonna|wanna|kinda|sorta|gotta)\b/i;
const task2Stance = /\b(?:i would argue that|i strongly believe|from my perspective|it is my firm belief|it could be argued that|there is a compelling case for|it is reasonable to assume that)\b/i;
const informalDescription = /\b(?:informal|colloquial|slang|conversational idiom)\b/i;
const positiveInformalUsage = /\b(?:this is (?:an? )?|use (?:this|it) in |suitable for )(?:informal|colloquial|casual conversations)/i;
const vagueReasons = new Set(['good', 'useful', 'advanced', 'native', 'nice', 'good expression', 'useful expression', 'useful phrase', 'worth saving', '很好', '有用', '高级', '地道', '高级表达']);

const string = value => typeof value === 'string' ? value.trim() : '';
const words = value => value.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
const normalized = value => value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/^[\s.,;:!?"“”]+|[\s.,;:!?"“”]+$/g, '');
const isEnglish = value => /[A-Za-z]/.test(value) && !/[\u3400-\u9fff]/.test(value);
const decision = (status, reasonZh, reasonEn) => ({ status, reasonZh, reasonEn, policyVersion: corpusPolicyVersion });

function quotePresent(answer, quote) {
  const haystack = answer.toLowerCase();
  const needle = quote.toLowerCase();
  const wordCharacter = character => !!character && /[\p{L}\p{N}_'’]/u.test(character);
  let offset = haystack.indexOf(needle);
  while (offset !== -1) {
    const left = !wordCharacter(needle[0]) || !wordCharacter(haystack[offset - 1]);
    const right = !wordCharacter(needle.at(-1)) || !wordCharacter(haystack[offset + needle.length]);
    if (left && right) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}

/**
 * New candidates require admission.approved === true plus verifiable context.
 * Legacy records without admission are rejected only for narrow local findings;
 * everything else stays pending until explicitly reviewed.
 */
export function assessExpression(expression, { scope, answerText } = {}) {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    return decision('rejected', '语料记录格式无效，无法准入。', 'The expression record is invalid.');
  }
  const quote = string(expression.textEn);
  const admission = expression.admission;
  // Honour a model rejection even if it deliberately leaves other fields empty.
  if (admission && typeof admission === 'object' && !Array.isArray(admission) && admission.approved === false) {
    return decision('rejected', string(admission.reasonZh) || 'AI 已判断这条表达不值得独立积累。', string(admission.reasonEn) || 'The model declined this expression for independent study.');
  }
  if (!quote || !isEnglish(quote) || words(quote).length === 0) {
    return decision('rejected', '请提供非空英文表达，中文解释应放在中文字段。', 'A non-empty English expression is required.');
  }
  if (words(quote).length < 2) {
    return decision('rejected', '孤立单词更适合单词本；语料库积累搭配、表达或句型。', 'Keep isolated words in the wordbook; the corpus stores collocations, expressions and structures.');
  }
  if (basicPhrases.has(normalized(quote)) || basicIntensifier.test(normalized(quote))) {
    return decision('rejected', '这是基础套话或泛泛组合，独立积累收益有限。请提取更具体的搭配或句型。', 'This basic stock phrase adds little independent study value; select a more specific collocation or structure.');
  }

  const currentScope = scope ?? expression.scope;
  if (currentScope !== undefined && !scopes.has(currentScope)) {
    return decision('rejected', '语料所属学习域无效，无法判断正确语域。', 'The expression has an unsupported IELTS scope.');
  }
  if (scope !== undefined && expression.scope !== undefined && scope !== expression.scope) {
    return decision('rejected', '表达与当前学习域不一致，不能跨库准入。', 'The expression does not belong to the current learning scope.');
  }
  if (currentScope?.startsWith('writing-') && (conversational.test(quote) || informalDescription.test(string(expression.categoryEn)) || positiveInformalUsage.test(string(expression.usageNoteEn)))) {
    return decision('rejected', '这条表达属于口语或非正式语域，不适合 Academic 写作语料库。', 'This conversational or informal expression does not fit the Academic writing corpus.');
  }
  if (currentScope === 'writing-task1' && task2Stance.test(quote)) {
    return decision('rejected', '这是立场或论证表达；Task 1 应客观描述给定图表，不能套用 Task 2 的观点句。', 'This stance or argument structure belongs to essay writing, not an objective Task 1 report.');
  }

  if (admission === undefined || admission === null) {
    return decision('pending', '历史语料缺少准入理由，需重新复核；本地规则不能确认完整语义价值。', 'This legacy item has no admission evidence and needs review; local rules do not establish its full semantic value.');
  }
  if (typeof admission !== 'object' || Array.isArray(admission) || admission.approved !== true) {
    return decision('rejected', '准入判断格式无效，approved 必须是明确的布尔值。', 'Admission must contain an explicit boolean approval.');
  }
  if (!currentScope) {
    return decision('pending', '尚缺所属学习域，补齐上下文后才能确认准入。', 'The learning scope is missing; provide context before approving this expression.');
  }
  if (typeof answerText !== 'string' || !answerText.trim()) {
    return decision('pending', '尚缺原英文答案，无法核实这条语料是否实际出现。', 'The original answer is missing, so the expression cannot be verified.');
  }
  if (!quotePresent(answerText, quote)) {
    return decision('rejected', '表达没有作为连续原文出现在答案中；只允许大小写差异，不接受改写或补造。', 'The expression is not a continuous quote from the answer; only letter case may differ.');
  }
  if (!expressionBenefits.includes(admission.benefit)) {
    return decision('rejected', '准入收益类型无效，需明确搭配、地道性、精确性、结构或语篇用途。', 'Admission must specify a supported collocation, idiomatic, precision, structure or discourse benefit.');
  }
  const reasonZh = string(admission.reasonZh);
  const reasonEn = string(admission.reasonEn);
  if (!reasonZh || !reasonEn || !isEnglish(reasonEn)) {
    return decision('rejected', '缺少完整的中英准入理由，不能仅凭批准标志收录。', 'Both Chinese and English admission reasons are required; an approval flag alone is insufficient.');
  }
  if (vagueReasons.has(normalized(reasonZh)) || vagueReasons.has(normalized(reasonEn))) {
    return decision('rejected', '理由只有“高级、地道、有用”等泛泛判断，需说明具体学习收益。', 'A vague label such as "advanced" or "useful" is insufficient; explain the specific learning benefit.');
  }
  const usage = string(expression.usageNoteEn);
  if (!usage || !isEnglish(usage) || words(usage).length < 4) {
    return decision('rejected', '缺少明确英文用途说明，请补充适用语境或使用边界。', 'Provide a clear English usage note describing a context or usage boundary.');
  }
  const transfer = string(admission.transferExampleEn);
  if (!transfer || !isEnglish(transfer) || words(transfer).length < 4 || normalized(transfer) === normalized(quote)) {
    return decision('rejected', '缺少可迁移的英文例句；仅重复表达本身不能展示用法。', 'Provide a transferable English example; merely repeating the expression does not demonstrate usage.');
  }
  // The rationale remains model evidence, not a local claim to semantic certainty.
  return decision('approved', reasonZh, reasonEn);
}

/**
 * Preserve every original item, including rejected/legacy records. A caller can
 * resolve its stored answer with contextFor(expression); no DB is read or written.
 */
export function auditExpressions(expressions, options = {}) {
  if (!Array.isArray(expressions)) throw new TypeError('expressions must be an array');
  const counts = { approved: 0, rejected: 0, pending: 0 };
  const items = expressions.map(expression => {
    const context = typeof options.contextFor === 'function' ? options.contextFor(expression) ?? {} : options;
    const assessment = assessExpression(expression, context);
    counts[assessment.status]++;
    return { expression, assessment };
  });
  return { items, counts, policyVersion: corpusPolicyVersion };
}
