import type { Expression, Job } from './types';
export function expressionStatus(expression: Expression): 'approved' | 'rejected' | 'pending';
export function isApprovedExpression(expression: Expression): boolean;
export function latestQuestionJob(jobs: Job[], questionId: string): Job | null;
export function mergeJob(jobs: Job[], incoming: Job): Job[];
export interface JobWatch { id: string; status: string; runId?: string; startedAt?: string }
export function createJobTracker(saved?: JobWatch[]): { observe(jobs: Job[]): Job[]; serialize(): JobWatch[] };
