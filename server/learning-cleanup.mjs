import { assert } from './domain.mjs';

const records = backup => backup.learning;
const ids = values => new Set((values ?? []).filter(value => typeof value === 'string'));
const materialRefs = record => [
  ...(record.materialIds ?? []),
  ...(record.materialSpans ?? []).map(span => span.materialId),
  ...(record.materialSnapshots ?? []).map(material => material.id),
  ...(record.selectedMaterialSnapshots ?? []).map(material => material.id),
  ...Object.keys(record.materialVersions ?? {}),
];
const expressionRefs = record => [
  ...(record.expressionIds ?? []),
  ...(record.expressionSnapshots ?? []).map(expression => expression.id),
  ...(record.selectedExpressionSnapshots ?? []).map(expression => expression.id),
];
const learningTables = ['answers', 'revisions', 'drafts', 'jobs', 'materials', 'material_revisions', 'expressions', 'words', 'links', 'review_states', 'review_events'];

/** Pure, conservative removal of the question belonging to the earliest job. */
export function clearFirstUseFromBackup(original, { expectedQuestionId } = {}) {
  assert(original?.format === 'yasy-backup' && original.version === 1 && original.bank && original.learning, '需要完整的 Yasy v1 学习备份。');
  assert(Array.isArray(original.bank.questions), '备份缺少题库。');
  for (const table of ['answers', 'revisions', 'drafts', 'jobs', 'materials', 'expressions', 'words', 'links', 'plans']) assert(Array.isArray(records(original)[table]), `备份缺少 ${table}。`);
  const backup = structuredClone(original);
  const learning = records(backup);
  const removed = Object.fromEntries(learningTables.map(table => [table, 0]));
  removed.planEntries = 0;
  if (!learning.jobs.length) return { backup, target: null, removed };
  assert(learning.jobs.every(job => Number.isFinite(Date.parse(job.createdAt))), '任务缺少可靠创建时间，无法确定首次记录。');
  const earliest = [...learning.jobs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  const question = backup.bank.questions.find(item => item.id === earliest.questionId);
  assert(question, '首次任务引用的题目不存在，未清理任何内容。', 404);
  if (expectedQuestionId !== undefined) assert(expectedQuestionId === question.id, '首次记录的题目已变化，请重新预览后再清理。', 409);
  const target = { questionId: question.id, titleZh: question.titleZh };
  const targetAnswers = [...learning.answers, ...learning.revisions].filter(answer => answer.questionId === question.id);
  const candidateMaterials = ids(targetAnswers.flatMap(materialRefs));
  const candidateExpressions = ids(targetAnswers.flatMap(expressionRefs));
  const deletedAnswers = ids(targetAnswers.map(answer => answer.id));
  const deletedWords = ids(learning.words.filter(word => word.questionId === question.id).map(word => word.id));

  for (const table of ['answers', 'revisions', 'drafts', 'jobs']) learning[table] = learning[table].filter(item => item.questionId !== question.id);
  learning.words = learning.words.filter(word => !deletedWords.has(word.id));
  const otherRecords = [...learning.answers, ...learning.revisions, ...learning.drafts, ...learning.jobs];
  const protectedMaterials = ids(otherRecords.flatMap(materialRefs));
  const protectedExpressions = ids(otherRecords.flatMap(expressionRefs));
  const deletedMaterials = ids(learning.materials.filter(material => candidateMaterials.has(material.id) && !protectedMaterials.has(material.id)).map(material => material.id));
  // A retained, independently linked material is also evidence of shared use.
  for (const link of learning.links) if (link.kind === 'material-expression' && !deletedMaterials.has(link.fromId)) protectedExpressions.add(link.toId);
  const deletedExpressions = ids(learning.expressions.filter(expression => candidateExpressions.has(expression.id) && !protectedExpressions.has(expression.id)).map(expression => expression.id));
  learning.materials = learning.materials.filter(material => !deletedMaterials.has(material.id));
  learning.expressions = learning.expressions.filter(expression => !deletedExpressions.has(expression.id));
  if (learning.material_revisions) learning.material_revisions = learning.material_revisions.filter(revision => !deletedMaterials.has(revision.materialId));
  learning.links = learning.links.filter(link => !deletedMaterials.has(link.fromId)
    && !(link.kind === 'material-expression' && deletedExpressions.has(link.toId))
    && !(link.kind === 'material-question' && link.toId === question.id));
  for (const table of ['review_states', 'review_events']) if (learning[table]) learning[table] = learning[table].filter(review => !(review.kind === 'answer' && deletedAnswers.has(review.targetId)) && !(review.kind === 'word' && deletedWords.has(review.targetId)));
  learning.plans = learning.plans.map(plan => {
    const questionIds = plan.questionIds.filter(id => id !== question.id);
    removed.planEntries += plan.questionIds.length - questionIds.length;
    return { ...plan, questionIds };
  });
  for (const table of learningTables) removed[table] = (records(original)[table]?.length ?? 0) - (learning[table]?.length ?? 0);
  return { backup, target, removed };
}
