export type Scope = 'speaking' | 'writing-task1' | 'writing-task2';
export interface Source { id: string; title: string; url: string; type: 'official' | 'reported' | 'user-upload'; accessedAt: string; reportedAt?: string; note: string }
export interface Topic { id: string; scope: Scope; titleZh: string; titleEn: string; description: string; tags: string[] }
export interface Question { id: string; topicId: string; scope: Scope; part?: 'Part 1' | 'Part 2' | 'Part 3'; titleZh: string; promptEn: string; promptZh: string; cuePoints?: string[]; tags: string[]; sourceId: string; sourceType: 'official' | 'reported' | 'adapted'; basis?: string; reportedAt?: string; taskType?: string; visual?: { kind: 'table' | 'bar' | 'line' | 'pie' | 'process' | 'map'; title: string; columns?: string[]; rows?: (string | number)[][]; steps?: string[]; note?: string } }
export interface Material { id: string; scope: Scope; title: string; summaryZh: string; detailZh: string; summaryEn?: string; detailEn?: string; tags: string[]; createdAt: string }
export interface Expression { id: string; scope: Scope; textEn: string; meaningZh: string; category: string; categoryEn?: string; exampleEn: string; usageNote: string; usageNoteEn?: string; tags: string[]; createdAt: string }
export interface MaterialSpan { start: number; end: number; materialId: string }
export interface Answer { id: string; questionId: string; textEn: string; outlineZh: string; wordCount: number; materialIds: string[]; expressionIds: string[]; materialSpans?: MaterialSpan[]; updatedAt: string; jobId: string }
export interface Draft { questionId: string; textZh: string; materialIds: string[]; updatedAt: string }
export interface Word { id: string; textEn: string; meaningZh: string; exampleEn: string; scope: Scope; questionId?: string; createdAt: string }
export interface Link { fromId: string; toId: string; kind: 'material-question' | 'material-expression'; score: number; reason: string }
export interface Job { id: string; questionId: string; scope: Scope; textZh: string; materialIds: string[]; prompt: string; status: 'pending' | 'completed' | 'needs-revision'; createdAt: string }
export interface Settings { targetBand: string; examType: 'academic' | 'general'; provider: 'web-bridge'; dailySpeaking: number; dailyWriting: number }
export interface Quality { passed: boolean; score: number; suggestions: string[]; checks: { label: string; passed: boolean }[]; note: string }
export interface Recommendation { material: Material; score: number; reason: string }
export interface ExpressionRecommendation { expression: Expression; score: number; reason: string }
export interface ReviewItem { kind: 'answer' | 'word'; id: string; questionId?: string; question?: Question; answer?: Answer; word?: Word; reviewCount: number; dueAt: string }
export interface ReviewQueue { item: ReviewItem | null; remaining: number; dueCount: number; total: number; nextDueAt?: string }
export interface BatchQuestion { key: string; scope: Scope; topicZh: string; topicEn: string; titleZh: string; promptEn: string; promptZh: string; part: string; taskType: string; cuePoints: string[]; tags: string[]; sourceNote: string; sourceType: 'reported' | 'adapted'; visual: Question['visual'] | null; duplicate?: boolean }
export interface BatchJob { id: string; filename: string; scope: Scope | 'mixed'; prompt: string; createdAt: string; status: 'pending' | 'previewed' | 'completed'; candidates?: BatchQuestion[] }
export interface State { sources: Source[]; topics: Topic[]; questions: Question[]; answers: Answer[]; materials: Material[]; expressions: Expression[]; links: Link[]; words: Word[]; drafts: Draft[]; jobs: Job[]; settings: Settings; dailyPlan: { date: string; questionIds: string[] }; storage: { kind: string; location: string }; provider: { id: string; label: string; automated: boolean } }
