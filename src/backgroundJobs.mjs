export const expressionStatus = expression => expression.admission?.status ?? 'pending';
export const isApprovedExpression = expression => expressionStatus(expression) === 'approved';
export function latestQuestionJob(jobs, questionId) {
  return jobs.filter(job => job.questionId === questionId).reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}
export function mergeJob(jobs, incoming) {
  const existing = jobs.find(job => job.id === incoming.id);
  if (!existing) return [...jobs, incoming];
  const olderRun = existing.startedAt && incoming.startedAt && Date.parse(incoming.startedAt) < Date.parse(existing.startedAt);
  const sameRun = existing.runId ? existing.runId === incoming.runId : existing.startedAt === incoming.startedAt;
  const terminal = ['completed', 'failed', 'needs-revision'].includes(existing.status);
  if (olderRun || (sameRun && terminal && ['pending', 'processing'].includes(incoming.status))) return jobs;
  return jobs.map(job => job.id === incoming.id ? incoming : job);
}
export function createJobTracker(saved) {
  const records = new Map((Array.isArray(saved) ? saved : []).filter(row => row && typeof row.id === 'string' && typeof row.status === 'string').map(row => [row.id, row]));
  let initialized = Array.isArray(saved);
  return {
    observe(jobs) {
      const events = [];
      for (const job of jobs) {
        const previous = records.get(job.id);
        const terminal = ['completed', 'failed', 'needs-revision'].includes(job.status);
        const sameRun = previous && (previous.runId ? previous.runId === job.runId : previous.startedAt === job.startedAt);
        if (sameRun && ['completed', 'failed', 'needs-revision'].includes(previous.status) && ['pending', 'processing'].includes(job.status)) continue;
        if (initialized && terminal && previous && (previous.status === 'processing' || previous.status === 'pending')) events.push(job);
        records.set(job.id, { id: job.id, status: job.status, runId: job.runId, startedAt: job.startedAt });
      }
      initialized = true;
      return events;
    },
    serialize() { return [...records.values()].slice(-1000); },
  };
}
