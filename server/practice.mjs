import { assert } from './domain.mjs';

const kinds = ['speaking', 'writing'];
const modes = ['first', 'switch', 'random'];
const matchesKind = (question, kind) => kind === 'speaking'
  ? question.scope === 'speaking'
  : ['writing-task1', 'writing-task2'].includes(question.scope);

/**
 * Select unfinished, editable practice without changing drafts, plans or jobs.
 * remaining includes busy questions; waiting counts only busy unfinished ones.
 * Store.all preserves the same question order used by State.questions.
 */
export function getPracticeNext(store, { kind, mode = 'first', currentId, random = Math.random } = {}) {
  assert(kinds.includes(kind), '请选择口语或写作刷题。');
  assert(modes.includes(mode), '未知刷题选择方式。');
  const all = store.all('questions');
  if (currentId !== undefined) {
    assert(typeof currentId === 'string' && currentId.trim().length > 0 && currentId.length <= 150, '当前题目 ID 无效。');
    const current = all.find(question => question.id === currentId && question.active !== false);
    assert(current, '当前题目不存在或已归档。', 404);
    assert(matchesKind(current, kind), '当前题目不属于本次刷题范围。');
  }
  const questions = all.filter(question => question.active !== false && matchesKind(question, kind));
  const answered = new Set(store.all('answers').map(answer => answer.questionId));
  const processing = new Set(store.all('jobs').filter(job => job.status === 'processing').map(job => job.questionId));
  const unfinished = questions.filter(question => !answered.has(question.id));
  const remaining = unfinished.length;
  const waiting = unfinished.filter(question => processing.has(question.id)).length;
  const response = (question, reason) => ({ question, remaining, waiting, reason });

  if (!questions.length) return response(null, 'no-questions');
  if (!remaining) return response(null, 'all-completed');
  const available = unfinished.filter(question => !processing.has(question.id));
  if (!available.length) return response(null, 'processing');
  const candidates = available.filter(question => question.id !== currentId);
  if (!candidates.length) return response(available[0], 'only-current');

  if (mode === 'random') {
    assert(typeof random === 'function', '随机选择器无效。');
    const value = random();
    assert(Number.isFinite(value) && value >= 0 && value < 1, '随机选择器应返回 0 到 1 之间的数值。');
    return response(candidates[Math.floor(value * candidates.length)], 'ready');
  }
  if (mode === 'switch' && currentId !== undefined) {
    const currentIndex = questions.findIndex(question => question.id === currentId);
    const candidateIds = new Set(candidates.map(question => question.id));
    for (let offset = 1; offset < questions.length; offset++) {
      const next = questions[(currentIndex + offset) % questions.length];
      if (candidateIds.has(next.id)) return response(next, 'ready');
    }
  }
  return response(candidates[0], 'ready');
}
