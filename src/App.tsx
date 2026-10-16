import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Clipboard, CloudOff, Copy, ExternalLink, FileText, FolderOpen, Layers3, Leaf, LoaderCircle, Menu, MessageCircle, Plus, PlugZap, Repeat2, Search, Settings2, Shuffle, Sparkles, Sprout, Trash2, Upload, Volume2, X } from 'lucide-react';
import Recall from './Recall';
import { AnnotatedText } from './AnnotatedText';
import { EnglishContext } from './EnglishContext';
import { MaterialDetail, ExpressionDetail } from './ReadingDetails';
import BatchImport from './BatchImport';
import QuestionChart from './QuestionChart';
import ImportPreview from './ResultPreview';
import AISettings from './AISettings';
import MobileSettings from './MobileSettings';
import { exportBlob } from './exportFile';
import { IOSSheet, isNativeIOS } from './IOSSheet';
import { createIOSRouteHistory, nativeBackTicket } from './iosNavigation';
import { checkIOSQuality } from './mobileLocal/prompts.mjs';
import { applyNativeAppearance, initialNativeAppearance, nativeRoute, postNativeNavigation } from './nativeBridge';
import { createPendingDraftCache } from './pendingDrafts';
import { createDraftSaveQueue } from './draftSaveQueue';
import { createSnapshotGate } from './snapshotGate.mjs';
import BackgroundTasks from './BackgroundTasks';
import { createJobTracker, expressionStatus, isApprovedExpression, latestQuestionJob, mergeJob } from './backgroundJobs.mjs';
import type { AIConfig, Answer, Draft, Expression, ExpressionRecommendation, Job, Material, Quality, Question, Recommendation, Scope, State, Word } from './types';

export type PracticeKind = 'speaking' | 'writing';
export type WorkspaceStep = 'write' | 'bridge' | 'answer';
export type PracticeResult = { question: Question | null; remaining: number; waiting: number; reason: 'ready' | 'all-completed' | 'processing' | 'no-questions' | 'only-current' };
type PracticeMode = 'first' | 'switch' | 'random';
type PracticeNavigation = { kind: PracticeKind; busy: boolean; next: (mode: 'switch' | 'random') => Promise<void> };
type View = 'today' | 'recall' | 'speaking' | 'writing' | 'words' | 'settings';
type TabRoute = { view: View; questionId: string | null; questionPrefill: Material[]; writingScope: Scope; practiceKind: PracticeKind | null; practiceResult: PracticeResult | null; practiceError: string; workspaceStep?: WorkspaceStep; scrollY: number };
const pendingIOSDrafts = createPendingDraftCache();
const draftSaves = createDraftSaveQueue();
export async function flushDraftWrites() { window.dispatchEvent(new Event('pagehide')); await draftSaves.drain(); }
type LibraryTab = 'topics' | 'materials' | 'expressions';
type SnapshotRead = { state: State; commit: (onCommit?: () => void) => boolean };
type OpenMaterial = (material: Material, version?: number) => void;
type OpenQuestion = (question: Question, prefill?: Material[]) => void;
type IdeaDraft = { draftZh: string; origin: 'generated' | 'refined'; notes: string[]; requiresConfirmation: boolean; sourceZh: string };
type WordInput = { textEn: string; meaningZh: string; exampleEn: string; scope: Scope; questionId?: string };
const scopeLabel: Record<Scope, string> = { speaking: '口语', 'writing-task1': '小作文 · Task 1', 'writing-task2': '大作文 · Task 2' };
const scopeShort: Record<Scope, string> = { speaking: '口语', 'writing-task1': '小作文', 'writing-task2': '大作文' };
const navItems: { id: View; label: string; icon: typeof BookOpen }[] = [
  { id: 'today', label: '今日积累', icon: Sprout }, { id: 'recall', label: '背书', icon: Repeat2 }, { id: 'speaking', label: '口语区', icon: AudioLines }, { id: 'writing', label: '作文区', icon: FileText }, { id: 'words', label: '单词本', icon: BookOpen },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json().catch(() => ({ error: '服务器返回了无法读取的内容。' }));
  if (!response.ok) throw Object.assign(new Error(payload.error || '请求未成功，请重试。'), { payload });
  return payload as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
function saveDraft(questionId: string, draft: { textZh: string; materialIds: string[] }, keepalive = false) {
  const body = JSON.stringify(draft);
  return draftSaves.run(questionId, () => api<Draft>(`/drafts/${questionId}`, { method: 'PUT', keepalive, body }));
}
function useNarrowScreen() { const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches); useEffect(() => { const media = window.matchMedia('(max-width: 760px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []); return narrow; }
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function clientPolicy(search: string, narrow: boolean) { const nativeIOSClient = new URLSearchParams(search).get('client') === 'ios'; return { nativeIOSClient, iosClient: narrow || nativeIOSClient }; }
export function practicePath(kind: PracticeKind, mode: PracticeMode, currentId?: string): string { const query = new URLSearchParams({ kind, mode }); if (currentId) query.set('currentId', currentId); return `/practice/next?${query}`; }
export function practiceEmptyCopy(kind: PracticeKind, reason: PracticeResult['reason']) {
  const label = kind === 'speaking' ? '口语' : '作文';
  if (reason === 'all-completed') return { title: '这一组，已经积累完了', detail: `${label}题库里的题目都有答案了，可以去背书温习自己的表达。` };
  if (reason === 'processing') return { title: '让后台继续整理', detail: '未积累的题目都在后台处理中。可以查看任务结果，稍后再继续。' };
  if (reason === 'no-questions') return { title: '题库还在等待第一道题', detail: `先在${label === '口语' ? '口语区' : '作文区'}导入题库，再来这里逐题积累。` };
  return { title: '继续这一道题', detail: '目前没有另一道可练习的未积累题。可以完成当前素材，或稍后再试。' };
}

export function apiAvailable(config: AIConfig | null, iosClient: boolean): boolean { return !!config?.hasKey && !!config.model.trim() && (iosClient || config.provider === 'iiiapi'); }
export function jobRequest(questionId: string, textZh: string, materialIds: string[], iosClient: boolean) { return { questionId, textZh, materialIds: [...materialIds], ...(iosClient ? { client: 'ios' as const } : {}) }; }

export function recommendationRevision(question: Question, state: Pick<State, 'materials' | 'expressions' | 'links'>): string {
  const materials = state.materials.filter(item => item.scope === question.scope).sort((a, b) => a.id.localeCompare(b.id));
  const expressions = state.expressions.filter(item => item.scope === question.scope).sort((a, b) => a.id.localeCompare(b.id));
  const materialIds = new Set(materials.map(item => item.id));
  const expressionIds = new Set(expressions.map(item => item.id));
  const links = state.links.filter(link => materialIds.has(link.fromId) || expressionIds.has(link.toId)).sort((a, b) => `${a.kind}:${a.fromId}:${a.toId}`.localeCompare(`${b.kind}:${b.fromId}:${b.toId}`));
  return JSON.stringify([
    [question.id, question.scope, question.topicId, question.promptEn, question.promptZh, question.cuePoints || [], question.tags],
    materials.map(item => [item.id, item.version ?? 1, item.updatedAt || item.createdAt, item.title, item.summaryZh, item.detailZh, item.summaryEn, item.detailEn, item.tags]),
    expressions.map(item => [item.id, expressionStatus(item), item.admission?.policyVersion, item.admission?.reasonZh, item.admission?.reasonEn, item.textEn, item.meaningZh, item.category, item.categoryEn, item.exampleEn, item.usageNote, item.usageNoteEn, item.tags]),
    links.map(link => [link.kind, link.fromId, link.toId, link.score, link.reason]),
  ]);
}

function Empty({ icon: Icon = FolderOpen, title, detail, action }: { icon?: typeof BookOpen; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={27} strokeWidth={1.5} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  useEffect(() => { if (isNativeIOS()) return; const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, [close]);
  if (isNativeIOS()) return <IOSSheet title={title} close={close} wide={wide}>{children}</IOSSheet>;
  return <div className="modal-overlay" onClick={close}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><X size={20} /></button></header>{children}</section></div>;
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const snapshotGate = useRef(createSnapshotGate());
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('today');
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [questionPrefill, setQuestionPrefill] = useState<Material[]>([]);
  const [writingScope, setWritingScope] = useState<Scope>('writing-task2');
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [wordInput, setWordInput] = useState<WordInput | null>(null);
  const [activeMaterial, setActiveMaterial] = useState<{ material: Material; version?: number } | null>(null);
  const [activeExpression, setActiveExpression] = useState<Expression | null>(null);
  const [batchScope, setBatchScope] = useState<Scope | 'mixed' | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [practiceKind, setPracticeKind] = useState<PracticeKind | null>(null);
  const [practiceResult, setPracticeResult] = useState<PracticeResult | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const practiceGate = useRef(createSnapshotGate());
  const nativeTicket = useRef(0);
  const [nativeAcknowledgement, setNativeAcknowledgement] = useState(0);
  const [workspaceStep, setWorkspaceStep] = useState<WorkspaceStep>();
  const nativeRoutes = useRef(createIOSRouteHistory<TabRoute>((next, current) => ({ view: next, questionId: null, questionPrefill: [], writingScope: current.writingScope, practiceKind: null, practiceResult: null, practiceError: '', workspaceStep: undefined, scrollY: 0 })));
  const [nativeRestoration, setNativeRestoration] = useState<{ top: number; sequence: number }>({ top: 0, sequence: 0 });
  const nativeScrollToken = useRef(0);
  const nativeCurrentRoute = useRef<TabRoute | null>(null);
  nativeCurrentRoute.current = { view, questionId, questionPrefill, writingScope, practiceKind, practiceResult, practiceError, workspaceStep, scrollY: 0 };
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const narrow = useNarrowScreen();
  const { nativeIOSClient, iosClient } = clientPolicy(window.location.search, narrow);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [launching, setLaunching] = useState<string[]>([]);
  const stateRef = useRef<State | null>(null);
  const tracker = useRef<ReturnType<typeof createJobTracker> | null>(null);
  if (!tracker.current) { let saved; try { saved = JSON.parse(localStorage.getItem('yasy-job-watch') || 'null'); } catch {} tracker.current = createJobTracker(Array.isArray(saved) ? saved : undefined); }
  stateRef.current = state;
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const observeState = useCallback((next: State) => {
    const events = tracker.current!.observe(next.jobs);
    try { localStorage.setItem('yasy-job-watch', JSON.stringify(tracker.current!.serialize())); } catch {}
    if (!events.length) return;
    if (events.length > 1) { notify(`后台已更新 ${events.length} 个任务，请查看后台任务。`, events.some(job => job.status !== 'completed')); return; }
    const job = events[0]; const question = [...next.questions, ...(next.archivedQuestions || [])].find(item => item.id === job.questionId);
    notify(`${question?.titleZh || '学习任务'}：${job.status === 'completed' ? '答案已整理并保存' : job.status === 'needs-revision' ? '中文素材需要补充，查看反馈后修改' : job.error || 'AI 整理失败，可在后台任务重试'}。`, job.status !== 'completed');
  }, [notify]);
  const commitState = useCallback((next: State) => { snapshotGate.current.invalidate(); pendingIOSDrafts.observeSnapshot(next.drafts); stateRef.current = next; setState(next); observeState(next); }, [observeState]);
  const commitDraft = useCallback((draft: Draft) => {
    snapshotGate.current.invalidate(); pendingIOSDrafts.observeSnapshot([draft]);
    const current = stateRef.current; if (!current) return;
    const existing = current.drafts.find(item => item.questionId === draft.questionId);
    if (existing && existing.updatedAt > draft.updatedAt) return;
    const next = { ...current, drafts: [...current.drafts.filter(item => item.questionId !== draft.questionId), draft] };
    stateRef.current = next; setState(next);
  }, []);
  const readSnapshot = useCallback(async (): Promise<SnapshotRead> => { const ticket = snapshotGate.current.begin(); const next = await api<State>('/state'); return { state: next, commit: onCommit => snapshotGate.current.apply(ticket, () => { pendingIOSDrafts.observeSnapshot(next.drafts); stateRef.current = next; setState(next); observeState(next); onCommit?.(); }) }; }, [observeState]);
  const reload = useCallback(async () => { const snapshot = await readSnapshot(); snapshot.commit(); return snapshot.state; }, [readSnapshot]);
  const registerJob = useCallback((job: Job) => { snapshotGate.current.invalidate(); const current = stateRef.current; if (!current) return; const next = { ...current, jobs: mergeJob(current.jobs, job) }; stateRef.current = next; setState(next); observeState(next); }, [observeState]);
  const launchingRef = useRef(new Set<string>());
  const runBackground = useCallback(async (job: Job) => {
    const current = stateRef.current;
    if (launchingRef.current.has(job.id) || current?.jobs.some(item => item.questionId === job.questionId && (item.status === 'processing' || launchingRef.current.has(item.id)))) { notify('这道题正在后台整理，请等待本次任务完成。'); return; }
    launchingRef.current.add(job.id); setLaunching([...launchingRef.current]);
    try { const result = await api<{ state: State; job: Job }>(`/jobs/${job.id}/generate`, post({ background: true })); registerJob(result.job); await reload(); }
    catch (error) { notify(errorMessage(error), true); try { await reload(); } catch {} throw error; }
    finally { launchingRef.current.delete(job.id); setLaunching([...launchingRef.current]); }
  }, [notify, registerJob, reload]);
  useEffect(() => { reload().catch(error => setLoadError(errorMessage(error))); api<AIConfig>('/ai/config').then(setAIConfig).catch(error => notify(errorMessage(error), true)); }, [reload, notify]);
  useEffect(() => {
    const restored = () => {
      reload().then(() => setLoadError('')).catch(error => notify(errorMessage(error), true));
      api<AIConfig>('/ai/config').then(setAIConfig).catch(error => notify(errorMessage(error), true));
    };
    window.addEventListener('yasy:connection-restored', restored);
    return () => window.removeEventListener('yasy:connection-restored', restored);
  }, [reload, notify]);
  const runningKey = state?.jobs.filter(job => job.status === 'processing').map(job => job.id).sort().join('|') || '';
  const launchingKey = launching.join('|');
  useEffect(() => {
    if (!state) return; let active = true; let inFlight = false; let reportedError = false;
    const poll = async () => { if (inFlight) return; inFlight = true; try { const snapshot = await readSnapshot(); if (active) { snapshot.commit(); reportedError = false; } } catch (error) { if (active && !reportedError) { notify(errorMessage(error), true); reportedError = true; } } finally { inFlight = false; } };
    const timer = setInterval(poll, runningKey || launchingKey ? 2500 : 15000);
    const visible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [!!state, runningKey, launchingKey, readSnapshot, notify]);
  const changeAIConfig = useCallback((config: AIConfig) => { setAIConfig(config); reload().catch(error => notify(errorMessage(error), true)); }, [reload, notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  const resetPractice = () => { practiceGate.current.invalidate(); setPracticeBusy(false); setPracticeKind(null); setPracticeResult(null); setPracticeError(''); };
  const captureNativeRoute = (): TabRoute => ({ ...nativeCurrentRoute.current!, questionPrefill: [], scrollY: window.scrollY });
  const applyNativeRoute = (route: TabRoute) => {
    practiceGate.current.invalidate(); snapshotGate.current.invalidate();
    setView(route.view); setQuestionId(route.questionId); setQuestionPrefill(route.questionPrefill);
    setWritingScope(route.writingScope); setPracticeKind(route.practiceKind); setPracticeResult(route.practiceResult);
    setPracticeError(route.practiceError); setPracticeBusy(false); setMobileMenu(false); setWorkspaceStep(route.workspaceStep);
    nativeCurrentRoute.current = route;
    setNativeRestoration({ top: route.scrollY, sequence: ++nativeScrollToken.current });
    if (route.practiceKind && !route.practiceResult && !route.questionId) void choosePractice(route.practiceKind);
  };
  const navigate = (next: View) => {
    if (nativeIOSClient) { applyNativeRoute(nativeRoutes.current.select(captureNativeRoute(), next)); return; }
    resetPractice(); snapshotGate.current.invalidate(); setView(next); setQuestionId(null); setMobileMenu(false);
  };
  const openQuestion: OpenQuestion = (question, prefill = []) => {
    if (nativeIOSClient) nativeScrollToken.current++;
    const keepPractice = view === 'today' && practiceKind !== null && !!state?.questions.some(item => item.id === question.id);
    practiceGate.current.invalidate(); setPracticeBusy(false); setPracticeError(''); setPracticeResult(null);
    setPracticeKind(keepPractice ? question.scope === 'speaking' ? 'speaking' : 'writing' : null);
    snapshotGate.current.invalidate(); setQuestionPrefill(prefill); setQuestionId(question.id); if (nativeIOSClient) setWorkspaceStep(undefined);
    setView(keepPractice ? 'today' : question.scope === 'speaking' ? 'speaking' : 'writing');
    if (question.scope !== 'speaking') setWritingScope(question.scope); window.scrollTo({ top: 0 });
  };
  const currentQuestion = state?.questions.find(item => item.id === questionId) || state?.archivedQuestions?.find(item => item.id === questionId) || (practiceResult?.question?.id === questionId ? practiceResult.question : undefined);
  const leaveQuestion = () => { resetPractice(); snapshotGate.current.invalidate(); setQuestionId(null); if (nativeIOSClient) { nativeScrollToken.current++; setWorkspaceStep(undefined); } };
  const choosePractice = async (kind: PracticeKind, mode: PracticeMode = 'first', currentId?: string) => {
    if (nativeIOSClient) nativeScrollToken.current++;
    const ticket = practiceGate.current.begin(); setPracticeBusy(true); setPracticeError(''); setPracticeKind(kind); setView('today'); setMobileMenu(false);
    if (mode === 'first') { setQuestionId(null); setPracticeResult(null); }
    try {
      const result = await api<PracticeResult>(practicePath(kind, mode, currentId));
      // Refresh persisted answers/drafts before mounting the selected workspace.
      await reload();
      practiceGate.current.apply(ticket, () => {
        setPracticeResult(result); setPracticeBusy(false);
        if (result.question) { setQuestionPrefill([]); setQuestionId(result.question.id); if (nativeIOSClient) setWorkspaceStep(undefined); if (result.question.scope !== 'speaking') setWritingScope(result.question.scope); if (result.reason === 'only-current') notify('目前只有这一道可练习的未积累题，继续完成它就好。'); }
        else setQuestionId(null);
        if (result.reason !== 'only-current') window.scrollTo({ top: 0 });
      });
    } catch (error) { practiceGate.current.apply(ticket, () => { setPracticeBusy(false); setPracticeError(errorMessage(error)); notify(errorMessage(error), true); }); }
  };
  const openMaterial: OpenMaterial = (material, version) => setActiveMaterial({ material, version });
  const apiMode = iosClient || (aiConfig?.provider || state?.settings.provider) === 'iiiapi';
  const runningCount = state?.jobs.filter(job => job.status === 'processing' || launching.includes(job.id)).length || 0;
  useEffect(() => {
    if (!nativeIOSClient) return;
    document.body.classList.add('native-ios');
    applyNativeAppearance(initialNativeAppearance());
    const appearance = (event: Event) => applyNativeAppearance((event as CustomEvent).detail);
    const route = (event: Event) => {
      const next = nativeRoute((event as CustomEvent).detail);
      if (!next || (next.ticket !== undefined && next.ticket <= nativeTicket.current)) return;
      if (next.ticket !== undefined) { nativeTicket.current = next.ticket; setNativeAcknowledgement(next.ticket); }
      navigate(next.view);
    };
    const back = (event: Event) => {
      const ticket = nativeBackTicket((event as CustomEvent).detail);
      if (ticket === null || ticket <= nativeTicket.current) return;
      nativeTicket.current = ticket; setNativeAcknowledgement(ticket);
      const dismiss = new Event('yasy:dismiss-sheet', { cancelable: true });
      window.dispatchEvent(dismiss); if (dismiss.defaultPrevented) return;
      applyNativeRoute(nativeRoutes.current.back(captureNativeRoute()));
    };
    const tasks = () => setTasksOpen(true);
    window.addEventListener('yasy:navigate', route);
    window.addEventListener('yasy:back', back);
    window.addEventListener('yasy:background-tasks', tasks);
    window.addEventListener('yasy:appearance', appearance);
    return () => {
      document.body.classList.remove('native-ios');
      window.removeEventListener('yasy:navigate', route);
      window.removeEventListener('yasy:back', back);
      window.removeEventListener('yasy:background-tasks', tasks);
      window.removeEventListener('yasy:appearance', appearance);
    };
  }, [nativeIOSClient]);
  useEffect(() => {
    if (!nativeIOSClient || !nativeRestoration.sequence) return;
    let frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(() => {
      if (nativeScrollToken.current === nativeRestoration.sequence && !document.activeElement?.matches('input,textarea,[contenteditable="true"]')) window.scrollTo({ top: nativeRestoration.top, behavior: 'instant' });
    }); });
    return () => window.cancelAnimationFrame(frame);
  }, [nativeIOSClient, nativeRestoration]);
  useEffect(() => {
    if (!nativeIOSClient) return;
    postNativeNavigation({ view, canGoBack: view === 'settings' || !!currentQuestion || !!practiceKind,
      backTitle: view === 'settings' ? nativeRoutes.current.settingsOrigin()?.questionId ? '返回练习' : '返回' : '返回',
      backgroundCount: runningCount, ticket: nativeTicket.current,
      title: currentQuestion ? `${scopeShort[currentQuestion.scope]}练习` : { today: '今日积累', recall: '背书', speaking: '口语区', writing: '作文区', words: '单词本', settings: '设置' }[view] });
  }, [nativeIOSClient, view, currentQuestion?.id, practiceKind, runningCount, nativeAcknowledgement]);
  const currentScope: Scope = view === 'speaking' ? 'speaking' : writingScope;
  const addWord = (input: WordInput) => setWordInput(input);


  if (!state) return <div className="loading-screen"><div className="brand-loading">yasy<span>.</span></div>{loadError ? <><p>{loadError}</p><button className="button primary" onClick={() => { setLoadError(''); reload().catch(error => setLoadError(errorMessage(error))); }}>重新连接本机服务</button></> : <><LoaderCircle className="spin" size={24} /><p>正在打开你的学习工作台…</p></>}</div>;

  return <EnglishContext addWord={addWord}><div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <a href="#" className="brand" onClick={event => { event.preventDefault(); navigate('today'); }} aria-label="Yasy 首页">yasy<span>.</span><Leaf size={17} /></a>
      <div className="sidebar-caption">YOUR IELTS WORKBENCH</div>
      <nav aria-label="主导航">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={21} strokeWidth={1.7} /><span>{label}</span>{view === id && <span className="nav-active-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="target-card"><span>目标 IELTS</span><strong>{state.settings.targetBand}<small> BAND</small></strong><div className="target-note"><span /> 每天，让表达生长一点</div></div><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={20} strokeWidth={1.7} /><span>偏好与数据</span></button><div className="local-label"><span className="status-dot" /> 本机存储 · 由你掌握</div></div>
    </aside>
    {mobileMenu && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMobileMenu(false)} />}
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22} /></button><span className="topbar-title">{currentQuestion ? `${scopeShort[currentQuestion.scope]}练习` : { today: '今日积累', recall: '背书', speaking: '口语区', writing: '作文区', words: '单词本', settings: '偏好与数据' }[view]}</span><span className="topbar-separator" /><span className="topbar-subtitle">真实素材，自己的表达</span></div><div className="topbar-right"><button className={`background-tasks-button ${runningCount ? 'has-running' : ''}`} onClick={() => setTasksOpen(true)}><Activity size={17} /><span>后台任务</span>{runningCount > 0 && <b>{runningCount}</b>}</button><span className="local-status"><span className="status-dot" /> LOCAL FIRST</span><span className="avatar">Y</span></div></header>
    <main className={`main-content ${currentQuestion ? 'workspace-content' : ''}`}>
      {currentQuestion ? <Workspace key={nativeIOSClient ? `${view}:${currentQuestion.id}` : currentQuestion.id} question={currentQuestion} prefill={questionPrefill} state={state} reload={reload} notify={notify} goBack={leaveQuestion} openQuestion={openQuestion} addWord={addWord} onMaterial={openMaterial} onExpression={setActiveExpression} aiConfig={aiConfig} registerJob={registerJob} runBackground={runBackground} questionBusy={state.jobs.some(job => job.questionId === currentQuestion.id && (job.status === 'processing' || launching.includes(job.id)))} apiMode={apiMode} iosClient={iosClient} practice={view === 'today' && practiceKind ? { kind: practiceKind, busy: practiceBusy, next: mode => choosePractice(practiceKind, mode, currentQuestion.id) } : undefined} onSettings={() => navigate('settings')} initialStep={nativeIOSClient ? workspaceStep : undefined} onStepChange={nativeIOSClient ? setWorkspaceStep : undefined} onDraftSaved={nativeIOSClient ? commitDraft : undefined} /> : view === 'today' ? (practiceKind ? <PracticeEmpty kind={practiceKind} result={practiceResult} loading={practiceBusy} error={practiceError} retry={() => choosePractice(practiceKind)} back={leaveQuestion} openTasks={() => setTasksOpen(true)} /> : <Today start={kind => choosePractice(kind)} busy={practiceBusy} />) : view === 'recall' ? <Recall state={state} notify={notify} onMaterial={openMaterial} onExpression={setActiveExpression} /> : (view === 'speaking' || view === 'writing') ? <Library key={currentScope} scope={currentScope} state={state} writingScope={writingScope} setWritingScope={setWritingScope} openQuestion={openQuestion} addWord={addWord} onExpression={setActiveExpression} openBatch={() => setBatchScope(currentScope)} reload={reload} notify={notify} /> : view === 'words' ? <Words state={state} reload={reload} notify={notify} addWord={addWord} /> : <Settings state={state} setState={commitState} reload={reload} notify={notify} openBatch={() => setBatchScope('mixed')} aiConfig={aiConfig} onAIConfigChange={changeAIConfig} apiOnly={iosClient} macClient={!nativeIOSClient} />}
    </main><footer className="page-footer"><span>yasy · 每一份素材都属于你</span><span>Mac 工作台 <span className="footer-dot">·</span> iPhone 独立学习</span></footer></div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <Circle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={16} /></button></div>}
    {activeMaterial && <MaterialDetail material={activeMaterial.material} preferredVersion={activeMaterial.version} state={state} notify={notify} close={() => setActiveMaterial(null)} openQuestion={openQuestion} onExpression={setActiveExpression} />}
    {activeExpression && <ExpressionDetail expression={activeExpression} close={() => setActiveExpression(null)} addWord={addWord} />}
    {batchScope && <BatchImport apiMode={apiMode} aiConfig={aiConfig} onSettings={() => { setBatchScope(null); navigate('settings'); }} initialScope={batchScope} close={() => setBatchScope(null)} notify={notify} onSaved={() => { reload().catch(error => notify(errorMessage(error), true)); }} />}
    {tasksOpen && <Modal title="后台 AI 任务" close={() => setTasksOpen(false)} wide><p className="modal-description">答案整理在本机服务中继续进行。你可以切换题目、继续写素材，完成后会收到通知。</p><BackgroundTasks state={state} launching={launching} canRetry={apiAvailable(aiConfig, iosClient)} openQuestion={question => { setTasksOpen(false); openQuestion(question); }} retry={runBackground} /></Modal>}
    {wordInput && <WordModal input={wordInput} close={() => setWordInput(null)} saved={async () => { await reload(); setWordInput(null); notify('已收进单词本。'); }} notify={notify} />}

  </div></EnglishContext>;
}

export function Today({ start, busy }: { start: (kind: PracticeKind) => void; busy: boolean }) {
  return <section className="today-choices" aria-label="今日积累入口"><button className="today-choice speaking-choice" disabled={busy} onClick={() => start('speaking')}><span className="today-choice-icon"><AudioLines size={30} strokeWidth={1.5} /></span><div><h1>口语积累</h1><p>从一道题，讲出自己的故事。</p></div><ArrowRight size={22} /></button><button className="today-choice writing-choice" disabled={busy} onClick={() => start('writing')}><span className="today-choice-icon"><FileText size={30} strokeWidth={1.5} /></span><div><h1>作文积累</h1><p>从一个想法，组织完整的表达。</p></div><ArrowRight size={22} /></button></section>;
}
export function PracticeEmpty({ kind, result, loading, error, retry, back, openTasks }: { kind: PracticeKind; result: PracticeResult | null; loading: boolean; error: string; retry: () => void; back: () => void; openTasks: () => void }) {
  const copy = practiceEmptyCopy(kind, result?.reason || 'no-questions');
  return <div className="practice-empty-shell"><button className="text-button" onClick={back}><ArrowLeft size={17} />返回今日积累</button><section className="card practice-empty-card">{loading ? <><LoaderCircle size={30} className="spin" /><h2>正在准备下一道题…</h2></> : <><span className="practice-empty-icon">{result?.reason === 'all-completed' ? <CheckCircle2 size={31} strokeWidth={1.5} /> : result?.reason === 'processing' ? <Activity size={31} strokeWidth={1.5} /> : <BookOpen size={31} strokeWidth={1.5} />}</span><h2>{error ? '暂时没有连上题库' : copy.title}</h2><p>{error || copy.detail}</p><div className="practice-empty-actions">{result?.reason === 'processing' && <button className="button secondary" onClick={openTasks}><Activity size={16} />查看后台任务</button>}<button className="button secondary" onClick={retry}><Repeat2 size={16} />再看看题库</button><button className="button primary" onClick={back}>返回今日积累<ArrowRight size={16} /></button></div></>}</section></div>;
}

function Library({ scope, state, writingScope, setWritingScope, openQuestion, addWord, onExpression, openBatch, reload, notify }: { scope: Scope; state: State; writingScope: Scope; setWritingScope: (scope: Scope) => void; openQuestion: OpenQuestion; addWord: (input: WordInput) => void; onExpression: (expression: Expression) => void; openBatch: () => void; reload: () => Promise<State>; notify: (message: string, error?: boolean) => void }) {
  const [tab, setTab] = useState<LibraryTab>('topics');
  const [corpusStatus, setCorpusStatus] = useState<'approved' | 'pending' | 'rejected'>('approved');
  const [auditing, setAuditing] = useState(false);
  const [query, setQuery] = useState('');
  const [part, setPart] = useState('all');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [detailMaterial, setDetailMaterial] = useState<Material | null>(null);
  const [materialLanguage, setMaterialLanguage] = useState<'en' | 'zh'>('en');
  const questions = state.questions.filter(question => question.scope === scope);
  const matchQuestion = (question: Question) => { const topic = state.topics.find(item => item.id === question.topicId); return (part === 'all' || question.part === part) && `${topic?.titleZh || ''} ${topic?.titleEn || ''} ${question.titleZh} ${question.promptEn} ${question.promptZh} ${question.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()); };
  const topics = state.topics.filter(topic => topic.scope === scope && (questions.some(question => question.topicId === topic.id && matchQuestion(question)) || (!query && part === 'all')));
  const activeTopic = state.topics.find(topic => topic.id === topicId);
  const materials = state.materials.filter(material => material.scope === scope && `${material.title} ${material.summaryZh} ${material.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const expressions = state.expressions.filter(expression => expression.scope === scope && expressionStatus(expression) === corpusStatus && `${expression.textEn} ${expression.meaningZh} ${expression.category}`.toLowerCase().includes(query.toLowerCase()));
  const counts = { topics: questions.length, materials: state.materials.filter(item => item.scope === scope).length, expressions: state.expressions.filter(item => item.scope === scope && isApprovedExpression(item)).length };
  const auditCorpus = async () => { setAuditing(true); try { await api('/corpus/audit', post({})); await reload(); notify('旧语料复核已完成，已更新各组收录状态。'); } catch (error) { notify(errorMessage(error), true); } finally { setAuditing(false); } };
  return <><div className="page-heading"><div><div className="eyebrow">{scope === 'speaking' ? 'SPEAK WITH YOUR OWN STORIES' : 'WRITE WITH A CLEAR PURPOSE'}</div><h1>{scope === 'speaking' ? '口语区' : '作文区'}<span className="heading-dot">.</span></h1><p>{scope === 'speaking' ? '真实经历 × 自然表达，为每一道题准备自己的答案。' : '从观点到论证，从图表到概述。用适合写作的语言，建立完整答案。'}</p></div><button className="button secondary" onClick={openBatch}><Upload size={16} />批量导入题库</button></div>
    {scope !== 'speaking' && <div className="writing-switch"><button className={writingScope === 'writing-task2' ? 'selected' : ''} onClick={() => setWritingScope('writing-task2')}><FileText size={18} /><span>大作文<small>TASK 2 · 观点与论证</small></span></button><button className={writingScope === 'writing-task1' ? 'selected' : ''} onClick={() => setWritingScope('writing-task1')}><Layers3 size={18} /><span>小作文<small>TASK 1 · Academic 图表</small></span></button></div>}
    <div className="library-toolbar"><div className="tabs">{([{ id: 'topics', label: '全话题题库', icon: FolderOpen }, { id: 'materials', label: '素材库', icon: Layers3 }, { id: 'expressions', label: '语料库', icon: Sparkles }] as const).filter(item => !(scope === 'writing-task1' && item.id === 'materials')).map(({ id, label, icon: Icon }) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => { setTab(id); setQuery(''); setTopicId(null); }}><Icon size={17} />{label}<span>{counts[id]}</span></button>)}</div><div className="search-box"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索当前题库或积累" placeholder={tab === 'topics' ? '搜索话题、题目…' : tab === 'materials' ? '搜索你的素材…' : '搜索表达、中文含义…'} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div></div>
    {tab === 'topics' && <><div className="library-info"><span>{activeTopic ? <button className="text-button" onClick={() => setTopicId(null)}><ArrowLeft size={15} />全部话题</button> : <>{topics.length} 个主题 <span className="inline-dot">·</span> {questions.length} 道练习题</>}</span>{scope === 'speaking' && <div className="segmented small">{['all', 'Part 1', 'Part 2', 'Part 3'].map(item => <button key={item} className={part === item ? 'selected' : ''} onClick={() => setPart(item)}>{item === 'all' ? '全部' : item}</button>)}</div>}</div>{activeTopic ? <section className="card topic-detail"><div className="topic-detail-heading"><div><span className="eyebrow">{activeTopic.titleEn}</span><h2>{activeTopic.titleZh}</h2><p>{activeTopic.description}</p></div><span className="topic-glyph"><MessageCircle size={27} strokeWidth={1.4} /></span></div>{questions.filter(question => question.topicId === activeTopic.id && matchQuestion(question)).map(question => <QuestionRow key={question.id} question={question} state={state} openQuestion={openQuestion} />)}</section> : topics.length ? <div className="topic-grid">{topics.map((topic, index) => { const items = questions.filter(question => question.topicId === topic.id); const completed = items.filter(question => state.answers.some(answer => answer.questionId === question.id)).length; return <button className="topic-card" key={topic.id} onClick={() => setTopicId(topic.id)}><div className="topic-card-top"><span className={`topic-icon color-${index % 4}`}>{scope === 'speaking' ? <MessageCircle size={22} strokeWidth={1.5} /> : <FileText size={22} strokeWidth={1.5} />}</span><span className="topic-card-arrow"><ArrowRight size={18} /></span></div><h3>{topic.titleZh}</h3><span className="topic-en">{topic.titleEn}</span><p>{topic.description}</p><div className="topic-tags">{[...new Set(items.map(question => question.part || question.taskType).filter(Boolean))].slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><div className="topic-card-footer"><span>{items.length} 道题</span><span>{completed ? `${completed} 道已积累` : '等待你的第一个故事'}</span></div></button>; })}</div> : <Empty title="没有匹配的题目" detail="试试其他关键词，或切换 Part 筛选。" />}
    <div className="source-note"><BookOpen size={16} /><p>题目保留原文件与原文位置。考生回忆按上传题库记录，官方样题与改编练习分别标记。</p></div></>}
    {tab === 'materials' && <><div className="library-info"><span>每个素材元保存核心经历或论点，与具体题目的问法解耦。</span><div className="segmented small"><button className={materialLanguage === 'en' ? 'selected' : ''} onClick={() => setMaterialLanguage('en')}>English</button><button className={materialLanguage === 'zh' ? 'selected' : ''} onClick={() => setMaterialLanguage('zh')}>中文</button></div></div>{materials.length ? <div className="collection-grid">{materials.map(material => <button className="material-card card" key={material.id} onClick={() => setDetailMaterial(material)}><div className="collection-card-top"><Layers3 size={19} /><Pill>{material.tags[0] || '真实素材'}</Pill></div><h3>{materialLanguage === 'en' ? material.summaryEn || 'Original material' : material.title}</h3><p data-word-scope={material.scope}>{materialLanguage === 'en' ? material.detailEn || 'English version pending. Reprocess the original answer to add it.' : material.summaryZh}</p><div className="card-bottom"><span>{state.links.filter(link => link.kind === 'material-question' && link.fromId === material.id).length} 道关联题目</span><ArrowRight size={16} /></div></button>)}</div> : <Empty icon={Layers3} title={query ? '没有匹配的素材' : '你的真实素材，从这里生长'} detail={query ? '试试其他关键词。' : '完成一次口语或大作文处理后，拆解出的素材元会自动存入本域素材库。'} />}</>}
    {tab === 'expressions' && <><div className="library-info corpus-toolbar"><span>只有通过收录审核的表达，才会在答案中标注与推荐。</span><button className="button secondary small-button" disabled={auditing || !state.expressions.some(item => expressionStatus(item) === 'pending')} onClick={auditCorpus}>{auditing ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{auditing ? '正在复核旧语料…' : '复核旧语料'}</button></div><div className="segmented corpus-status-tabs">{([{ id: 'approved', label: '已收录' }, { id: 'pending', label: '待复核' }, { id: 'rejected', label: '未收录' }] as const).map(item => <button key={item.id} className={corpusStatus === item.id ? 'selected' : ''} onClick={() => setCorpusStatus(item.id)}>{item.label}<span>{state.expressions.filter(expression => expression.scope === scope && expressionStatus(expression) === item.id).length}</span></button>)}</div>{expressions.length ? <div className="collection-grid">{expressions.map(expression => <ExpressionCard key={expression.id} expression={expression} addWord={addWord} onExpression={onExpression} />)}</div> : <Empty icon={Sparkles} title={query ? '没有匹配的表达' : corpusStatus === 'approved' ? '这里等待值得反复使用的表达' : corpusStatus === 'pending' ? '没有待复核的语料' : '没有未收录的语料'} detail={query ? '可以搜索英文表达或中文意思。' : corpusStatus === 'approved' ? '有明确语义价值、可迁移且符合本域风格的表达，通过审核后会出现在这里。' : corpusStatus === 'pending' ? '旧语料会先进入待复核，再由当前收录规则审核。' : '未通过的条目仍保留在数据中，可以查看原因。'} />}</>}
    {detailMaterial && <MaterialDetail material={detailMaterial} state={state} notify={notify} close={() => setDetailMaterial(null)} openQuestion={openQuestion} onExpression={onExpression} />}
  </>;
}
function QuestionRow({ question, state, openQuestion }: { question: Question; state: State; openQuestion: OpenQuestion }) {
  const source = state.sources.find(item => item.id === question.sourceId);
  return <div className="question-row"><div className="question-row-body" onClick={() => openQuestion(question)}><div className="question-pills"><Pill>{question.part || question.taskType || scopeShort[question.scope]}</Pill><Pill tone={question.sourceType === 'official' ? 'green' : question.sourceType === 'reported' ? 'orange' : ''}>{question.sourceType === 'official' ? '官方样题' : question.sourceType === 'reported' ? '考生回忆' : '改编练习'}</Pill>{state.answers.some(answer => answer.questionId === question.id) && <Pill tone="green"><Check size={12} /> 已积累</Pill>}</div><button className="question-title" onClick={() => openQuestion(question)}>{question.titleZh}</button><p>{question.promptEn}</p>{source && <a className="source-link" href={source.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{source.title}<ExternalLink size={11} /></a>}{question.basis && <span className="question-source-page">{question.basis}</span>}</div><div className="question-row-actions"><button className="button primary small-button" onClick={() => openQuestion(question)}>开始练习<ArrowRight size={15} /></button></div></div>;
}
function ExpressionCard({ expression, addWord, onExpression }: { expression: Expression; addWord: (input: WordInput) => void; onExpression: (expression: Expression) => void }) { return <article className="expression-card card" data-word-scope={expression.scope}><div className="collection-card-top"><Pill tone="green">{expression.categoryEn || 'Useful expression'}</Pill><button className="icon-button" aria-label={`收藏 ${expression.textEn}`} title="Add to vocabulary" onClick={() => addWord({ textEn: expression.textEn, meaningZh: expression.meaningZh, exampleEn: expression.exampleEn, scope: expression.scope })}><Plus size={17} /></button></div><button className="expression-card-content" onClick={() => onExpression(expression)}><h3 className={isApprovedExpression(expression) ? 'expression-underline' : ''}>{expression.textEn}</h3><blockquote>{expression.exampleEn}</blockquote>{expression.usageNoteEn && <small className="usage-note">{expression.usageNoteEn}</small>}{!isApprovedExpression(expression) && <small className="admission-card-reason">{expression.admission?.reasonZh || '旧语料尚未通过当前收录审核。'}</small>}</button></article>; }

export function Workspace({ question, prefill, state, reload, notify, goBack, openQuestion, addWord, onMaterial, onExpression, aiConfig, registerJob, runBackground, questionBusy, apiMode, iosClient, practice, onSettings, initialStep, onStepChange, onDraftSaved }: { question: Question; prefill: Material[]; state: State; reload: () => Promise<State>; notify: (message: string, error?: boolean) => void; goBack: () => void; openQuestion: OpenQuestion; addWord: (input: WordInput) => void; onMaterial: OpenMaterial; onExpression: (expression: Expression) => void; aiConfig: AIConfig | null; registerJob: (job: Job) => void; runBackground: (job: Job) => Promise<void>; questionBusy: boolean; apiMode: boolean; iosClient: boolean; practice?: PracticeNavigation; onSettings: () => void; initialStep?: WorkspaceStep; onStepChange?: (step: WorkspaceStep) => void; onDraftSaved?: (draft: Draft) => void }) {
  const nativeUI = isNativeIOS();
  const isArchived = !state.questions.some(item => item.id === question.id);
  const pendingDraft = iosClient && !isArchived ? pendingIOSDrafts.read(question.id) : undefined;
  const draft = pendingDraft || state.drafts.find(item => item.questionId === question.id);
  const [textZh, setTextZh] = useState([draft?.textZh || '', ...prefill.filter(material => !draft?.materialIds.includes(material.id)).map(material => `【${material.title}】\n${material.detailZh}`)].filter(Boolean).join('\n\n'));
  const [materialIds, setMaterialIds] = useState<string[]>([...new Set([...(draft?.materialIds || []), ...prefill.map(material => material.id)])]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const recommendationGate = useRef(createSnapshotGate());
  const recommendationKey = recommendationRevision(question, state);
  const recommendationKeyRef = useRef(recommendationKey);
  recommendationKeyRef.current = recommendationKey;
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [expressionRecommendations, setExpressionRecommendations] = useState<ExpressionRecommendation[]>([]);
  const [quality, setQuality] = useState<Quality | null>(null);
  const job = latestQuestionJob(state.jobs, question.id);
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<WorkspaceStep>(initialStep && (initialStep === 'write' ? !isArchived : initialStep === 'bridge' ? !!job : state.answers.some(item => item.questionId === question.id)) ? initialStep : state.answers.some(item => item.questionId === question.id) ? 'answer' : questionBusy ? 'bridge' : 'write');
  const lastJobTransition = useRef(initialStep ? `${job?.id}:${job?.status}:${questionBusy}` : '');
  useEffect(() => { onStepChange?.(step); }, [step, onStepChange]);
  const [busy, setBusy] = useState('');
  const localPhone = iosClient && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('local') === '1';
  const savedLabel = localPhone ? '已保存到 iPhone' : iosClient ? '已同步到 Mac' : '已保存到本机';
  const [saveStatus, setSaveStatus] = useState(pendingDraft ? '等待保存' : draft ? savedLabel : '草稿自动保存');
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideaPreview, setIdeaPreview] = useState<IdeaDraft | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const initialSave = useRef(prefill.length === 0 && !pendingDraft);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const [compositionRevision, setCompositionRevision] = useState(0);
  const latestDraft = useRef({ textZh, materialIds, dirty: prefill.length > 0 || !!pendingDraft });
  latestDraft.current.textZh = textZh;
  latestDraft.current.materialIds = materialIds;
  const answer = state.answers.find(item => item.questionId === question.id);
  const source = state.sources.find(item => item.id === question.sourceId);
  const answerMaterials = answer?.materialSnapshots || state.materials.filter(item => answer?.materialIds.includes(item.id));
  const answerExpressions = state.expressions.filter(item => isApprovedExpression(item) && answer?.expressionIds.includes(item.id));
  const questionList = state.questions.filter(item => item.scope === question.scope);
  const nextQuestion = isArchived ? undefined : questionList[questionList.findIndex(item => item.id === question.id) + 1];
  const processing = questionBusy;
  const apiReady = apiAvailable(aiConfig, iosClient);
  const ideasReady = !!aiConfig?.hasKey && !!aiConfig.model;
  const answerJob = state.jobs.find(item => item.id === answer?.jobId);
  const editingLocked = !!busy || processing;
  const staleJob = !!job && (job.textZh !== textZh || JSON.stringify(job.materialIds) !== JSON.stringify(materialIds));
  useEffect(() => {
    if (isArchived) { setRecommendationsLoading(false); return; }
    const controller = new AbortController();
    const ticket = recommendationGate.current.begin();
    setRecommendationsLoading(true); setRecommendations([]); setExpressionRecommendations([]);
    api<{ materials: Recommendation[]; expressions: ExpressionRecommendation[] }>(`/questions/${question.id}/recommendations`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || recommendationKeyRef.current !== recommendationKey) return;
        recommendationGate.current.apply(ticket, () => { setRecommendations(result.materials); setExpressionRecommendations(result.expressions.filter(item => isApprovedExpression(item.expression))); setRecommendationsLoading(false); });
      })
      .catch(error => { if (!controller.signal.aborted && recommendationKeyRef.current === recommendationKey) recommendationGate.current.apply(ticket, () => { setRecommendationsLoading(false); notify(errorMessage(error), true); }); });
    return () => { controller.abort(); recommendationGate.current.invalidate(); };
  }, [question.id, recommendationKey, notify, isArchived]);
  useEffect(() => {
    if (isArchived) return;
    if (initialSave.current) { initialSave.current = false; return; }
    latestDraft.current.dirty = true;
    if (iosClient) pendingIOSDrafts.remember(question.id, { textZh, materialIds });
    if (nativeUI && composing.current) return;
    setSaveStatus('保存中…');
    const timer = setTimeout(() => { saveDraft(question.id, { textZh, materialIds }).then(async saved => { if (latestDraft.current.textZh === textZh && JSON.stringify(latestDraft.current.materialIds) === JSON.stringify(materialIds)) { latestDraft.current.dirty = false; setSaveStatus(savedLabel); } if (nativeUI) onDraftSaved?.(saved); else await reload(); }).catch(error => { setSaveStatus('保存失败'); notify(errorMessage(error), true); }); }, 600);
    saveTimer.current = timer;
    return () => { clearTimeout(timer); if (saveTimer.current === timer) saveTimer.current = null; };
  }, [textZh, materialIds, question.id, notify, reload, isArchived, nativeUI, compositionRevision, onDraftSaved]);
  useEffect(() => {
    const flush = () => {
      if (isArchived) return;
      const current = latestDraft.current;
      if (!current.dirty || (nativeUI && composing.current)) return;
      const snapshot = { textZh: current.textZh, materialIds: [...current.materialIds] };
      if (iosClient) pendingIOSDrafts.remember(question.id, snapshot);
      saveDraft(question.id, snapshot, true)
        .then(saved => {
          if (latestDraft.current.textZh === snapshot.textZh && JSON.stringify(latestDraft.current.materialIds) === JSON.stringify(snapshot.materialIds)) {
            latestDraft.current.dirty = false; setSaveStatus(savedLabel);
          }
          if (nativeUI) onDraftSaved?.(saved); else return reload();
        }).catch(error => { setSaveStatus('保存失败'); notify(errorMessage(error), true); });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('yasy:connection-restored', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('yasy:connection-restored', flush);
      document.removeEventListener('visibilitychange', onVisibility); flush();
    };
  }, [question.id, reload, notify, isArchived, nativeUI, onDraftSaved]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const transition = `${job?.id}:${job?.status}:${questionBusy}`;
    if (lastJobTransition.current === transition) return;
    lastJobTransition.current = transition;
    if (job?.status === 'processing' || questionBusy) setStep('bridge');
    else if (job?.status === 'completed') setStep('answer');
    else if (job?.status === 'needs-revision') { setQuality(job.quality || null); setStep('write'); }
    else if (job?.status === 'failed') setStep('bridge');
  }, [job?.id, job?.status, questionBusy]);
  const selectMaterial = (material: Material) => { if (editingLocked || isArchived) return; const block = `【${material.title}】\n${material.detailZh}`; if (materialIds.includes(material.id)) { setMaterialIds(materialIds.filter(id => id !== material.id)); setTextZh(textZh.replace(block, '').trim()); } else { setMaterialIds([...materialIds, material.id]); setTextZh([textZh.trim(), block].filter(Boolean).join('\n\n')); } setQuality(null); };
  const checkQuality = async () => { setBusy('quality'); try { const result = await api<Quality>('/quality', post({ questionId: question.id, textZh })); setQuality(result); if (result.passed) notify(apiMode ? '素材初检通过，可以交给 AI 整理。' : '素材初检通过，可以生成专属提示词。'); } catch (error) { notify(errorMessage(error), true); } finally { setBusy(''); } };
  const askForIdeas = async () => {
    if (isArchived || processing || ideasBusy || !ideasReady) return;
    const sourceZh = textZh; setIdeasBusy(true);
    try {
      const result = await api<{ draftZh: string; origin: 'generated' | 'refined'; notes: string[]; requiresConfirmation: boolean }>('/ideas', post({ questionId: question.id, textZh: sourceZh }));
      if (typeof result.draftZh !== 'string' || !result.draftZh.trim()) throw new Error('AI 未返回可用的中文构思，请重试。');
      if (mounted.current) setIdeaPreview({ ...result, notes: Array.isArray(result.notes) ? result.notes.filter(item => typeof item === 'string') : [], sourceZh });
    } catch (error) { notify(errorMessage(error), true); }
    finally { if (mounted.current) setIdeasBusy(false); }
  };
  const applyIdea = () => { if (!ideaPreview || processing || !!busy) return; setTextZh(ideaPreview.draftZh); setQuality(null); setIdeaPreview(null); notify(nativeUI ? '已填入素材' : '中文构思已填入，请按实际经历或观点修改后再整理英文答案。'); if (!nativeUI) editorRef.current?.focus(); };
  const generateJob = async (target: Job) => {
    if (isArchived || !apiReady) { notify('请先在偏好与数据中配置 iiiapi 密钥和模型。', true); return; }
    if (processing) { notify('这道题正在后台整理，请先练习其他题。'); return; }
    if (target.textZh !== textZh || JSON.stringify(target.materialIds) !== JSON.stringify(materialIds)) { notify('中文素材已更新，请重新创建处理任务。', true); return; }
    setBusy('generate'); setStep('bridge');
    try { await runBackground(target); }
    catch (error) { if (mounted.current) { const payload = (error as { payload?: { quality?: Quality } }).payload; if (payload?.quality) { setQuality(payload.quality); setStep('write'); } } }
    finally { if (mounted.current) setBusy(''); }
  };
  const createJob = async () => {
    if (isArchived || processing) return;
    if (apiMode && !apiReady) { notify('请先配置 API 密钥与模型。', true); return; }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setBusy('job');
    let enqueued = false;
    try {
      const result = await draftSaves.run(question.id, async () => {
        await api(`/drafts/${question.id}`, { method: 'PUT', body: JSON.stringify({ textZh, materialIds }) });
        if (latestDraft.current.textZh === textZh && JSON.stringify(latestDraft.current.materialIds) === JSON.stringify(materialIds)) {
          latestDraft.current.dirty = false; if (mounted.current) setSaveStatus(savedLabel);
        }
        return api<{ job: Job; prompt: string; quality: Quality }>('/jobs', post(jobRequest(question.id, textZh, materialIds, iosClient)));
      });
      registerJob(result.job);
      if (mounted.current) { setQuality(result.quality); setStep('bridge'); }
      if (apiMode) { enqueued = true; await runBackground(result.job); }
      else { await reload(); notify('专属提示词已生成，本次处理任务已保存。'); }
    } catch (error) {
      if (mounted.current) { const payload = (error as { payload?: { quality?: Quality } }).payload; if (payload?.quality) { setQuality(payload.quality); setStep('write'); } }
      if (!enqueued) notify(errorMessage(error), true);
    } finally { if (mounted.current) setBusy(''); }
  };
  const copyPrompt = async (open = false) => { if (!job) return; try { await navigator.clipboard.writeText(job.prompt); if (open) window.open('https://chatgpt.com', '_blank', 'noopener,noreferrer'); notify(open ? '提示词已复制，在 ChatGPT 新对话中粘贴即可。' : '提示词已复制。'); } catch { setShowPrompt(true); notify('浏览器未允许复制，请从展开的提示词中手动复制。', true); } };
  const parsePreview = () => { try { const cleaned = importText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); const parsed = JSON.parse(cleaned); if (parsed?.answer && (typeof parsed.answer !== 'object' || typeof parsed.answer.textEn !== 'string')) throw new Error('answer.textEn 必须是英文答案文本。'); if (parsed?.quality?.suggestions !== undefined && !Array.isArray(parsed.quality.suggestions)) throw new Error('quality.suggestions 必须是数组。'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请粘贴完整 JSON 对象。'); if (parsed.questionId && parsed.questionId !== question.id) throw new Error('这份结果属于其他题目，请核对 questionId。'); if (parsed.requestId && parsed.requestId !== job?.id) throw new Error('这份结果属于其他处理任务，请使用当前提示词生成的结果。'); if (parsed.scope && parsed.scope !== question.scope) throw new Error('这份结果的口语 / 写作领域与当前题目不一致。'); setPreview(parsed); } catch (error) { notify(`无法预览：${errorMessage(error)}`, true); } };
  const importResult = async () => { if (!job || !preview) return; setBusy('import'); try { await api(`/jobs/${job.id}/result`, post({ result: preview })); await reload(); setPreview(null); setImportText(''); setStep('answer'); notify('答案、素材与表达已整理入库。'); } catch (error) { const payload = (error as { payload?: { quality?: Quality } }).payload; if (payload?.quality) { setQuality(payload.quality); setStep('write'); setPreview(null); } notify(errorMessage(error), true); } finally { setBusy(''); } };
  const selectedAnswerWord = () => { const selection = window.getSelection()?.toString().trim(); if (!selection) { notify('请先选中答案里的英文单词或短语。'); return; } addWord({ textEn: selection, meaningZh: '', exampleEn: '', scope: question.scope, questionId: question.id }); };
  const outbound = answerMaterials.flatMap(material => state.links.filter(link => link.kind === 'material-question' && link.fromId === material.id && link.toId !== question.id).map(link => ({ ...link, material }))).sort((a, b) => b.score - a.score).filter((item, index, array) => array.findIndex(other => other.toId === item.toId) === index).slice(0, 3);

  return <><div className="workspace-top"><button className="text-button" onClick={goBack}><ArrowLeft size={17} />{nativeUI ? '返回' : practice ? '返回今日积累' : '返回题库'}</button><div className="workspace-top-actions">{practice && <button className="button secondary small-button" disabled={practice.busy} onClick={() => practice.next('switch')}>{practice.busy ? <LoaderCircle size={16} className="spin" /> : <Repeat2 size={16} />}换道题</button>}{!nativeUI && <span className="save-status"><Check size={13} /> {saveStatus}</span>}</div></div><div className="workspace-heading"><div><div className="question-pills"><Pill tone="green">{scopeLabel[question.scope]}</Pill>{isArchived && <Pill>已归档</Pill>}{question.part && <Pill>{question.part}</Pill>}{!nativeUI && <Pill tone={question.sourceType === 'reported' ? 'orange' : ''}>{question.sourceType === 'official' ? '官方样题' : question.sourceType === 'reported' ? '考生回忆' : '改编练习'}</Pill>}</div><h1>{question.titleZh}</h1></div></div>
    <section className="question-prompt card"><div className="prompt-eyebrow">{nativeUI ? '题目' : 'YOUR QUESTION'}</div><p className="question-english" data-word-scope={question.scope} data-word-question={question.id}>{question.promptEn}</p>{question.cuePoints?.length ? <ul className="cue-points">{question.cuePoints.map(point => <li key={point}>{point}</li>)}</ul> : null}{nativeUI ? <>{question.visual && <QuestionVisual question={question} />}<details className="ios-question-details"><summary>中文与来源<ChevronDown size={15} /></summary><p className="question-chinese">{question.promptZh}</p>{source && <div className="prompt-source"><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12} /></a>{question.basis && <span>{question.basis}</span>}{question.reportedAt && <span>{question.reportedAt}</span>}<span>{question.sourceType === 'official' ? '官方样题' : question.sourceType === 'reported' ? '考生回忆资料' : '改编练习'}</span></div>}</details></> : <><p className="question-chinese">{question.promptZh}</p>{question.visual && <QuestionVisual question={question} />}{source && <div className="prompt-source"><a href={source.url} target="_blank" rel="noreferrer">来源：{source.title}<ExternalLink size={12} /></a>{question.basis && <span>{question.basis}</span>}{question.reportedAt && <span>回忆时间：{question.reportedAt}</span>}</div>}</>}</section>
    {isArchived && <div className="archive-question-note"><BookOpen size={17} /><span>这道题已归档，历史答案与积累继续保留供温习。</span></div>}
    {processing && (!nativeUI || step !== 'bridge') && <div className="api-processing-banner" role="status"><LoaderCircle size={22} className="spin" /><div><strong>AI 正在整理你的答案</strong><p>{nativeUI ? '完成后自动保存，可继续写其他题。' : <>{job?.model || aiConfig?.model || '所选模型'} · 一次整理完整答案、素材与精选表达，校验通过后自动保存。</>}</p></div><button className="text-button" disabled={practice?.busy} onClick={practice ? () => practice.next('switch') : goBack}>{practice ? '换道题继续' : '去写其他题'}<ArrowRight size={14} /></button></div>}
    {job?.status === 'failed' && (!nativeUI || step !== 'bridge') && <div className="api-job-error"><Circle size={17} /><div><strong>上次 AI 整理未成功</strong><p>{job.error || '请检查连接与模型配置后重试。'}</p></div>{!isArchived && <button className="text-button" onClick={() => setStep('bridge')}>查看与重试<ArrowRight size={14} /></button>}</div>}
    {nativeUI ? <nav className="ios-workflow-tabs" aria-label="练习步骤">{([{ id: 'write', label: '素材' }, { id: 'bridge', label: '整理' }, { id: 'answer', label: '答案' }] as const).map(({ id, label }, index) => <button key={id} aria-current={step === id ? 'step' : undefined} className={step === id ? 'active' : ''} disabled={!!busy || (isArchived && id !== 'answer') || (id === 'bridge' && !job) || (id === 'answer' && !answer)} onClick={() => setStep(id)}><span className="ios-workflow-number" aria-hidden="true">{id === 'answer' && answer ? <Check size={12} /> : index + 1}</span><span>{label}</span></button>)}</nav> : <div className="workspace-steps">{([{ id: 'write', label: '写下中文素材', number: '01' }, { id: 'bridge', label: 'AI 整理与提取', number: '02' }, { id: 'answer', label: '答案与积累', number: '03' }] as const).map(({ id, label, number }) => <button key={id} className={step === id ? 'active' : ''} disabled={!!busy || (isArchived && id !== 'answer') || (id === 'bridge' && !job) || (id === 'answer' && !answer)} onClick={() => setStep(id)}><span>{id === 'answer' && answer ? <Check size={14} /> : number}</span>{label}<ChevronRight size={16} /></button>)}</div>}
    {step === 'write' && <div className="workspace-grid"><section className="card editor-card"><div className="section-heading"><div><h2>{nativeUI ? question.scope === 'writing-task1' ? '读图笔记' : '中文素材' : question.scope === 'writing-task1' ? '先读图，再组织信息' : '先记下你的中文想法'}</h2><p>{nativeUI ? question.scope === 'writing-task1' ? '记下趋势、对比和关键数据。' : '关键词或几句想法即可。' : question.scope === 'speaking' ? '粗略想法、关键词或几句中文都可以。AI 会帮你组织成自然、贴题的回答。' : question.scope === 'writing-task1' ? '记下你看见的趋势、对比与数据即可，AI 会按 Task 1 结构组织。' : '先写立场、理由或一个例子，不用写完整作文。AI 会帮助展开论证与组织语言。'}</p></div>{!nativeUI && <Pill>{textZh.length} 字</Pill>}</div><textarea ref={editorRef} className="chinese-editor" maxLength={nativeUI ? 20000 : undefined} disabled={editingLocked || isArchived} value={textZh} onChange={event => { setTextZh(event.target.value); setQuality(null); }} onCompositionStart={nativeUI ? () => { composing.current = true; setSaveStatus('输入中…'); if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } } : undefined} onCompositionEnd={nativeUI ? event => { composing.current = false; setTextZh(event.currentTarget.value); setCompositionRevision(value => value + 1); } : undefined} aria-label="中文素材编辑器" placeholder={nativeUI ? question.scope === 'speaking' ? '发生了什么？有什么细节和感受？' : question.scope === 'writing-task1' ? '总体趋势、关键对比、具体数据…' : '你的立场、理由和例子…' : question.scope === 'speaking' ? '不用先想英文，也不用把中文写得完整。\n\n可以先记关键词：发生了什么，和谁、在哪里？\n有哪个具体细节让你印象深刻？\n你的感受是什么，为什么？\n\n也可以从右侧挑选相关素材，修改成适合这道题的故事。' : question.scope === 'writing-task1' ? '总体趋势 / 主要特征：\n\n关键数据和比较：\n\n分组方式：\n\n请以题目给出的图表数据为依据。' : '我的立场：\n\n理由一 + 解释 + 具体例子：\n\n理由二 + 解释 + 具体例子：\n\n可讨论的另一面：'} /><div className="editor-bottom">{nativeUI ? <><span className="ios-save-status" role="status">{saveStatus}</span><span className="ios-draft-count">{textZh.length} 字{materialIds.length ? ` · ${materialIds.length} 素材` : ''}</span></> : <><span><CloudOff size={14} /> 中文素材自动保存</span><span>{materialIds.length ? `已选 ${materialIds.length} 个素材元` : '先真实，再流畅'}</span></>}</div>
      {quality && <QualityPanel quality={quality} />}
      {nativeUI ? <><div className="ios-editor-actions"><button className="button secondary" disabled={isArchived || editingLocked || ideasBusy || !ideasReady} onClick={askForIdeas}>{ideasBusy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{ideasBusy ? '构思中…' : textZh.trim() ? '展开素材' : '帮我想素材'}</button><button className="button primary" disabled={editingLocked || (textZh.length > 20000 || !checkIOSQuality(question, textZh).passed) || !aiConfig || !apiReady} onClick={createJob}>{busy === 'job' || busy === 'generate' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}生成答案</button></div><div className="ios-editor-options"><button className="text-button" disabled={editingLocked || !textZh.trim()} onClick={checkQuality}>{busy === 'quality' && <LoaderCircle className="spin" size={14} />}检查素材</button>{!apiReady && <button className="text-button" onClick={onSettings}>设置 API</button>}</div></> : <><div className="ideas-assist-row"><div><span>从一个粗略想法开始，也可以先让 AI 帮你构思。</span><small>中文助写独立调用，先预览确认再修改。</small></div><button className="button secondary" disabled={isArchived || editingLocked || ideasBusy || !ideasReady} onClick={askForIdeas}>{ideasBusy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{ideasBusy ? '正在构思…' : textZh.trim() ? '帮我展开素材' : '帮我想素材'}</button>{!ideasReady && <button className="text-button" onClick={onSettings}>配置 API 后可助写</button>}</div>
      <div className="editor-provider-note">{apiMode ? <><PlugZap size={15} /><span>API 后台整理 · {aiConfig?.model || '尚未选择模型'}</span>{!apiReady && <button className="text-button" onClick={onSettings}>前往配置</button>}</> : <><MessageCircle size={15} /><span>ChatGPT 网页桥接</span></>}</div><div className="editor-actions"><button className="button secondary" disabled={editingLocked || !textZh.trim()} onClick={checkQuality}>{busy === 'quality' ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}检查素材</button><button className="button primary" disabled={editingLocked || !textZh.trim() || !aiConfig || (apiMode && !apiReady)} onClick={createJob}>{busy === 'job' || busy === 'generate' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{apiMode ? '交给 AI 后台整理' : '生成专属提示词'}<ArrowRight size={15} /></button></div></>}</section><aside className="workspace-aside"><section className="card recommendation-card"><div className="section-heading"><div><h3>{nativeUI ? question.scope === 'writing-task1' ? '相关表达' : '可复用素材' : question.scope === 'writing-task1' ? '相关写作表达' : '可能用得上的素材'}</h3>{!nativeUI && <p>{question.scope === 'writing-task1' ? '小作文独立积累图表语料' : '本域素材检索 · 相关度 Top 3'}</p>}</div><Layers3 size={19} /></div>{recommendationsLoading ? <div className="recommendation-empty"><LoaderCircle size={24} className="spin" /><p>正在检索最新积累…</p></div> : question.scope === 'writing-task1' ? (expressionRecommendations.length ? expressionRecommendations.map(item => <div className="compact-expression" key={item.expression.id}><strong className="expression-underline" data-word-scope={question.scope} onClick={() => onExpression(item.expression)}>{item.expression.textEn}</strong><p data-word-scope={question.scope}>{item.expression.exampleEn}</p></div>) : <div className="recommendation-empty"><Sparkles size={27} strokeWidth={1.3} /><p>还没有可推荐的表达</p>{!nativeUI && <small>完成第一篇小作文后，图表描述语料会在这里积累。</small>}</div>) : recommendations.length ? recommendations.slice(0, 3).map((item, index) => <button disabled={editingLocked || isArchived} className={`recommendation-item ${materialIds.includes(item.material.id) ? 'selected' : ''}`} key={item.material.id} onClick={() => selectMaterial(item.material)}><div><span className="recommendation-rank">0{index + 1}</span><span className="recommendation-choice">{materialIds.includes(item.material.id) ? <Check size={13} /> : <Plus size={13} />}</span></div><h4>{item.material.title}</h4><p>{item.material.summaryZh}</p><small>{item.reason}</small><span className="recommendation-action">{materialIds.includes(item.material.id) ? '已填入草稿 · 可编辑' : '选择并填入中文素材'}</span></button>) : <div className="recommendation-empty"><Layers3 size={27} strokeWidth={1.3} /><p>{nativeUI ? '暂无相关素材' : '这是一个新的起点'}</p>{!nativeUI && <small>还没有相关素材。写下第一个真实故事，之后系统会为其他题目推荐它。</small>}</div>}</section>{!nativeUI && <div className="workspace-tip"><Leaf size={19} /><h4>素材可复用，答案要贴题。</h4><p>{question.scope === 'writing-task1' ? '图表写作关注客观描述。每次处理都使用专属 Task 1 提示词。' : '可以选择多个素材元。预填写后，请补充本题需要的细节，让它成为你的回答。'}</p></div>}</aside></div>}
    {step === 'bridge' && job && <>{staleJob && !processing && <div className="quality-panel stale-job"><div><Circle size={16} /><strong>中文素材已更新，请重新创建处理任务</strong></div><p>先返回中文素材，再使用最新内容整理答案。</p><button className="text-button" onClick={() => setStep('write')}><ArrowLeft size={14} />返回中文素材</button></div>}{apiMode ? <section className="card api-generation-card"><div className="api-generation-intro"><span className="provider-icon"><PlugZap size={23} /></span><div><h2>{nativeUI ? processing ? '正在整理答案' : job.status === 'failed' ? '整理失败' : job.status === 'completed' ? '答案已保存' : job.status === 'needs-revision' ? '请补充素材' : '生成英文答案' : processing ? 'AI 正在后台整理' : job.status === 'failed' ? '本次整理未完成' : job.status === 'completed' ? '答案已整理并保存' : job.status === 'needs-revision' ? '先补充素材，再继续' : '交给 AI 后台整理'}</h2><p>{nativeUI ? '完成后自动保存' : <>{job.model || aiConfig?.model || '请先选择模型'} · 完成校验后自动保存</>}</p></div><Pill tone={processing || job.status === 'completed' ? 'green' : ''}>{processing ? '后台处理中' : job.status === 'completed' ? '已完成' : '待处理'}</Pill></div>{processing && <p className="background-generation-note">{nativeUI ? '可切题继续，完成后会提醒。' : '你可以离开这里，继续写其他题。后台任务会保留进度；刷新页面后仍可查看状态。'}</p>}{job.error && <p className="ai-inline-error">{job.error}</p>}{job.quality && <QualityPanel quality={job.quality} />}<div className="api-generation-actions">{job.status === 'completed' && answer ? <button className="button primary" onClick={() => setStep('answer')}>查看英文答案<ArrowRight size={16} /></button> : job.status === 'needs-revision' ? <button className="button primary" onClick={() => setStep('write')}>补充中文素材<ArrowRight size={16} /></button> : !processing && <button className="button primary" disabled={!!busy || staleJob || !apiReady || isArchived} onClick={() => generateJob(job)}>{busy === 'generate' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{nativeUI ? job.status === 'failed' ? '重新整理' : '开始整理' : job.status === 'failed' ? '重试后台整理' : 'AI 整理并自动保存'}<ArrowRight size={15} /></button>}<button className="button secondary" disabled={practice?.busy} onClick={practice ? () => practice.next('switch') : goBack}>{practice ? '换道题继续' : '去写其他题'}<ArrowRight size={16} /></button>{!apiReady && <button className="text-button" onClick={onSettings}>配置 API</button>}</div></section> : <><div className="bridge-grid"><section className="card bridge-card"><div className="bridge-number">01</div><h2>把提示词交给 ChatGPT</h2><p>已包含本题、你的中文素材、{scopeShort[question.scope]}专属要求与 JSON 输出格式。</p><div className="bridge-info"><MessageCircle size={19} /><span>ChatGPT 网页桥接<small>复制 → 网页处理 → 粘贴结果</small></span><Pill tone="green">手动确认</Pill></div><button className="button primary full-width" onClick={() => copyPrompt(true)}><Copy size={17} />复制提示词并打开 ChatGPT<ExternalLink size={15} /></button><div className="bridge-secondary"><button className="text-button" onClick={() => copyPrompt()}><Clipboard size={14} />仅复制提示词</button><a className="text-button" href="https://chatgpt.com" target="_blank" rel="noreferrer">打开 ChatGPT<ExternalLink size={12} /></a><button className="text-button" onClick={() => setShowPrompt(!showPrompt)}>查看提示词<ChevronDown size={14} /></button></div>{showPrompt && <textarea className="prompt-preview" readOnly aria-label="完整提示词" value={job.prompt} />}<div className="bridge-note"><Leaf size={16} /><p>在 ChatGPT 新对话中粘贴提示词。完成后复制它输出的完整 JSON，回到右侧导入。当前任务已保存，关闭页面后仍可继续。</p></div></section><section className="card import-card"><div className="bridge-number orange">02</div><h2>带回你的答案与积累</h2><p>系统会先预览，再校验并存入对应的答案、素材库与语料库。</p><textarea className="json-editor" disabled={processing} placeholder={'粘贴 ChatGPT 返回的完整 JSON…\n\n支持包含 ```json 代码块的结果。'} value={importText} onChange={event => { setImportText(event.target.value); setPreview(null); }} aria-label="粘贴 AI 返回 JSON" /><div className="import-bottom"><small>校验题目、长度、素材与表达关联</small><button className="button primary" disabled={!importText.trim() || processing} onClick={parsePreview}>预览导入<ArrowRight size={15} /></button></div></section></div></>}</>}
    {step === 'answer' && answer && <><div className="answer-layout"><section className="card answer-card"><div className="section-heading"><div><div className="eyebrow">YOUR OWN ANSWER</div><h2>你的英文答案</h2></div><Pill tone="green">{answer.wordCount || wordCount(answer.textEn)} words</Pill></div><div className="answer-tools"><span><span className="highlight-dot" />素材颜色 · 表达红色波浪线</span><button className="text-button" onClick={selectedAnswerWord}><Plus size={15} />{nativeUI ? '收藏选中文字' : '选中文本加入单词本'}</button></div><div className="answer-text" onMouseUp={() => {}}><AnnotatedText text={answer.textEn} answer={answer} materials={answerMaterials} expressions={answerExpressions} scope={question.scope} questionId={question.id} onMaterial={material => onMaterial(material, answer.materialVersions?.[material.id])} onExpression={onExpression} /></div><div className="annotation-legend"><span><i className="legend-material" />点击色块，查看素材</span><span><i className="legend-expression" />点击红线，查看表达</span></div><div className="answer-footer">{!isArchived && <button className="button secondary" disabled={editingLocked} onClick={() => setStep('write')}>修改素材，重新整理</button>}{practice ? <button className="button primary" disabled={practice.busy} onClick={() => practice.next('random')}>{practice.busy ? <LoaderCircle size={16} className="spin" /> : <Shuffle size={16} />}下一道未积累题<ArrowRight size={16} /></button> : nextQuestion && <button className="button primary" onClick={() => openQuestion(nextQuestion)}>下一道题<ArrowRight size={16} /></button>}</div></section><aside className="answer-aside"><section className="card"><div className="section-heading"><div><h3>这次积累的表达</h3><p>{scopeShort[question.scope]}语料 · {answerExpressions.length} 条</p></div><Sparkles size={18} /></div>{answerJob?.corpusReview && <p className="corpus-review-note">本次筛选：{answerJob.corpusReview.filter(item => item.status === 'approved').length} 条收录 / {answerJob.corpusReview.filter(item => item.status !== 'approved').length} 条未收录</p>}{answerExpressions.length ? answerExpressions.map(expression => <div className="answer-expression" key={expression.id}><div><strong className="expression-underline" onClick={() => onExpression(expression)}>{expression.textEn}</strong><button className="icon-button" title="加入单词本" aria-label={`收藏${expression.textEn}`} onClick={() => addWord({ textEn: expression.textEn, meaningZh: expression.meaningZh, exampleEn: expression.exampleEn, scope: question.scope, questionId: question.id })}><Plus size={15} /></button></div><p data-word-scope={question.scope} data-word-question={question.id}>{expression.exampleEn}</p><small data-word-scope={question.scope}>{expression.usageNoteEn || ''}</small></div>) : <p className="muted">本次没有符合收录标准的表达。</p>}</section></aside></div>{question.scope !== 'writing-task1' && <section className="answer-material-section"><div className="section-heading"><div><h2>从这道题，拆出的素材元</h2><p>保留核心事件或论点，下一次回答时可以自由组合。</p></div><Pill>{answerMaterials.length} 个素材元</Pill></div><div className="collection-grid">{answerMaterials.map(material => <article className="card material-card" key={material.id}><div className="collection-card-top"><Layers3 size={18} /><Pill tone="green">独立素材元</Pill></div><h3>{material.summaryEn || 'Original material'}</h3><p data-word-scope={material.scope}>{material.detailEn || 'English version pending.'}</p><button className="text-button" onClick={() => onMaterial(material, answer.materialVersions?.[material.id])}>English / 中文<ArrowRight size={14} /></button><div className="linked-pills">{state.links.filter(link => link.kind === 'material-expression' && link.fromId === material.id && state.expressions.some(item => item.id === link.toId && isApprovedExpression(item))).sort((a, b) => b.score - a.score).slice(0, 3).map(link => { const expression = state.expressions.find(item => item.id === link.toId && isApprovedExpression(item)); return expression ? <span key={link.toId} title={link.reason}>{expression.textEn}</span> : null; })}</div></article>)}</div></section>}{outbound.length > 0 && <section className="outbound-section"><div className="section-heading"><div><h2>这个素材，还可以回答…</h2><p>相关题目 Top 3，点开后选择素材并继续修改。</p></div><ArrowRight size={20} /></div><div className="recent-grid">{outbound.map(item => { const related = state.questions.find(question => question.id === item.toId); return related && <button className="outbound-card" key={item.toId} onClick={() => openQuestion(related, [state.materials.find(material => material.id === item.material.id) || item.material])}><Pill>{related.part || scopeShort[related.scope]}</Pill><h3>{related.titleZh}</h3><p>{item.reason}</p><span>使用「{item.material.title}」<ArrowRight size={15} /></span></button>; })}</div></section>}</>}
    {ideaPreview && <Modal title={nativeUI ? '中文素材草稿' : ideaPreview.origin === 'refined' ? 'AI 帮你展开的中文素材' : 'AI 为本题构思的中文素材'} close={() => setIdeaPreview(null)} wide><div className="ideas-preview-notice"><Sparkles size={18} /><p>{nativeUI ? 'AI 构思示例，请按真实情况修改。' : '这是 AI 构思参考，尚未确认是你的真实经历或观点。请按自己的实际情况修改；填入后仍需要你确认内容，再生成英文答案。'}</p></div><div className="ideas-draft-preview">{ideaPreview.draftZh}</div>{ideaPreview.notes.length > 0 && <div className="ideas-preview-notes"><h3>补充与修改提示</h3><ul>{ideaPreview.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}{textZh !== ideaPreview.sourceZh && <p className="ideas-draft-changed">{nativeUI ? '当前草稿已修改，填入将替换它。' : '你在构思期间修改了草稿。填入会替换当前中文内容；也可以保留当前草稿。'}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setIdeaPreview(null)}>保留当前草稿</button><button className="button primary" disabled={processing || !!busy} onClick={applyIdea}><Check size={16} />{nativeUI ? textZh !== ideaPreview.sourceZh ? '替换草稿' : '填入素材' : textZh !== ideaPreview.sourceZh ? '替换当前草稿并继续修改' : '填入并继续修改'}</button></div></Modal>}
    {!apiMode && preview && <Modal title="确认本次积累" close={() => setPreview(null)} wide><ImportPreview preview={preview} onMaterial={onMaterial} onExpression={onExpression} /><p className="import-preview-note">确认后执行完整校验。每道题保留一个当前答案；重新导入会替换答案，并保留已有素材与表达。</p><div className="modal-actions"><button className="button secondary" onClick={() => setPreview(null)}>返回修改</button><button className="button primary" disabled={!!busy} onClick={importResult}>{busy === 'import' ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}确认校验并保存</button></div></Modal>}
  </>;
}
function QualityPanel({ quality }: { quality: Quality }) { return <section className={`quality-panel ${quality.passed ? 'passed' : ''}`}><div><CheckCircle2 size={18} /><strong>{quality.passed ? '素材初检通过' : '让素材再具体一些'}</strong></div><p>{quality.note}</p><div className="quality-checks">{quality.checks.map(check => <span key={check.label} className={check.passed ? 'passed' : ''}>{check.passed ? <Check size={13} /> : <Circle size={12} />}{check.label}</span>)}</div>{quality.suggestions.length > 0 && <ul>{quality.suggestions.map(item => <li key={item}>{item}</li>)}</ul>}</section>; }
function QuestionVisual({ question }: { question: Question }) { const visual = question.visual; if (!visual) return null; return <div className="question-visual"><strong>{visual.title}</strong><QuestionChart visual={visual} />{visual.rows && <div className="table-scroll"><table><thead><tr>{visual.columns?.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{visual.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>}{visual.note && <small>{visual.note}</small>}</div>; }


function Words({ state, reload, notify, addWord }: { state: State; reload: () => Promise<State>; notify: (message: string, error?: boolean) => void; addWord: (input: WordInput) => void }) {
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const [deleteWord, setDeleteWord] = useState<Word | null>(null);
  const [busy, setBusy] = useState(false);
  let words = state.words.filter(word => (scope === 'all' || word.scope === scope) && `${word.textEn} ${word.meaningZh}`.toLowerCase().includes(query.toLowerCase()));
  if (order.length) words = words.sort((a, b) => { const ai = order.indexOf(a.id); const bi = order.indexOf(b.id); return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi); });
  const shuffle = () => { const ids = words.map(word => word.id); for (let index = ids.length - 1; index > 0; index--) { const selected = Math.floor(Math.random() * (index + 1)); [ids[index], ids[selected]] = [ids[selected], ids[index]]; } setOrder(ids); notify('已打乱顺序，换个角度温习。'); };
  const remove = async () => { if (!deleteWord) return; setBusy(true); try { await api(`/words/${deleteWord.id}`, { method: 'DELETE' }); await reload(); setDeleteWord(null); notify('已从单词本移除。'); } catch (error) { notify(errorMessage(error), true); } finally { setBusy(false); } };
  return <><div className="page-heading"><div><div className="eyebrow">WORDS THAT BECOME YOURS</div><h1>单词本<span className="heading-dot">.</span></h1><p>口语和作文的单词，一起收藏，分开温习。</p></div><button className="button primary" onClick={() => addWord({ textEn: '', meaningZh: '', exampleEn: '', scope: 'speaking' })}><Plus size={17} />添加单词或短语</button></div><div className="words-toolbar"><div className="segmented">{['all', 'speaking', 'writing-task2', 'writing-task1'].map(item => <button className={scope === item ? 'selected' : ''} key={item} onClick={() => setScope(item)}>{item === 'all' ? '全部单词' : scopeShort[item as Scope]}</button>)}</div><div className="words-actions"><button className="button secondary small-button" onClick={() => setHidden(!hidden)}>{hidden ? '显示中文' : '隐藏中文'}</button><button className="button secondary small-button" disabled={!words.length} onClick={shuffle}><Shuffle size={15} />随机乱序</button></div></div><div className="library-info"><span>共 {words.length} 个单词与短语</span><div className="search-box"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索英文或中文…" aria-label="搜索单词" /></div></div>{words.length ? <div className="word-grid">{words.map(word => <WordCard key={word.id} word={word} hidden={hidden} onRemove={() => setDeleteWord(word)} />)}</div> : <Empty icon={BookOpen} title={query || scope !== 'all' ? '这里还没有匹配的单词' : '属于你的单词本，还是一张白纸'} detail="在答案里选中一个英文单词或短语，点击收藏。也可以手动添加，从今天开始积累。" action={<button className="button primary" onClick={() => addWord({ textEn: '', meaningZh: '', exampleEn: '', scope: scope === 'all' ? 'speaking' : scope as Scope })}><Plus size={16} />收藏第一个单词</button>} />}{deleteWord && <Modal title="移除这个单词？" close={() => setDeleteWord(null)}><p className="modal-description">「{deleteWord.textEn}」将从单词本移除，原答案和语料仍保留。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteWord(null)}>保留</button><button className="button danger" disabled={busy} onClick={remove}>{busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}移除</button></div></Modal>}</>;
}
function WordCard({ word, hidden, onRemove }: { word: Word; hidden: boolean; onRemove: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  useEffect(() => setRevealed(false), [hidden]);
  const speak = () => { if (!('speechSynthesis' in window)) { setSpeechStatus('浏览器不支持朗读'); return; } const utterance = new SpeechSynthesisUtterance(word.textEn); utterance.lang = 'en-GB'; utterance.onend = () => setSpeechStatus(''); utterance.onerror = () => setSpeechStatus('朗读不可用'); window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setSpeechStatus('正在朗读'); };
  return <article className="word-card card" data-word-scope={word.scope} data-word-question={word.questionId}><div className="collection-card-top"><Pill tone={word.scope === 'speaking' ? 'green' : 'orange'}>{scopeShort[word.scope]}</Pill><div><button className="icon-button" aria-label={`朗读${word.textEn}`} title={speechStatus || '朗读'} onClick={speak}><Volume2 size={17} /></button><button className="icon-button remove-word" title="移除" aria-label={`移除${word.textEn}`} onClick={onRemove}><Trash2 size={16} /></button></div></div><h3>{word.textEn}</h3>{hidden && !revealed ? <button className="reveal-meaning" onClick={() => setRevealed(true)}>点击回想中文意思</button> : <p>{word.meaningZh || '尚未填写中文含义'}</p>}{word.exampleEn && <blockquote>{word.exampleEn}</blockquote>}{speechStatus && <small className="muted">{speechStatus}</small>}</article>;
}
function WordModal({ input, close, saved, notify }: { input: WordInput; close: () => void; saved: () => Promise<void>; notify: (message: string, error?: boolean) => void }) { const [value, setValue] = useState(input); const [busy, setBusy] = useState(false); const save = async () => { setBusy(true); try { await api('/words', post(value)); await saved(); } catch (error) { notify(errorMessage(error), true); } finally { setBusy(false); } }; return <Modal title="收进单词本" close={close}><form onSubmit={event => { event.preventDefault(); save(); }}><label className="form-label">英文单词或短语<input required autoFocus value={value.textEn} onChange={event => setValue({ ...value, textEn: event.target.value })} placeholder="例如：a sense of belonging" /></label><label className="form-label">中文含义<input value={value.meaningZh} onChange={event => setValue({ ...value, meaningZh: event.target.value })} placeholder="用你自己的理解记录" /></label><label className="form-label">例句<textarea value={value.exampleEn} onChange={event => setValue({ ...value, exampleEn: event.target.value })} placeholder="可选，保留一个具体的使用场景" rows={3} /></label><label className="form-label">积累来源<select value={value.scope} onChange={event => setValue({ ...value, scope: event.target.value as Scope, questionId: event.target.value === input.scope ? input.questionId : undefined })}><option value="speaking">口语</option><option value="writing-task2">大作文 · Task 2</option><option value="writing-task1">小作文 · Task 1</option></select></label><div className="modal-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={busy || !value.textEn.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}收藏</button></div></form></Modal>; }

function Settings({ state, setState, reload, notify, openBatch, aiConfig, onAIConfigChange, apiOnly, macClient }: { state: State; setState: (state: State) => void; reload: () => Promise<State>; notify: (message: string, error?: boolean) => void; openBatch: () => void; aiConfig: AIConfig | null; onAIConfigChange: (config: AIConfig) => void; apiOnly: boolean; macClient: boolean }) {
  const nativeUI = isNativeIOS();
  const [band, setBand] = useState(state.settings.targetBand);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<{ object: Record<string, unknown>; filename: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const save = async () => { setBusy(true); try { await api('/settings', { method: 'PATCH', body: JSON.stringify({ targetBand: band }) }); await reload(); notify('学习偏好已保存。'); } catch (error) { notify(errorMessage(error), true); } finally { setBusy(false); } };
  const exportBackup = async (previous = false) => { try { const response = await fetch(previous ? '/api/backup/previous' : '/api/backup'); if (!response.ok) { const error = await response.json(); throw new Error(error.error || '导出失败。'); } const destination = await exportBlob(await response.blob(), `yasy-${previous ? 'before-restore' : 'backup'}-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())}.json`); notify(destination === 'native' ? '已打开系统分享，可存储到文件。' : '备份已导出，保存在浏览器下载目录。'); } catch (error) { notify(errorMessage(error), true); } };
  const readBackup = async (file?: File) => { if (!file) return; try { const object = JSON.parse(await file.text()); if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('备份必须是 JSON 对象。'); setBackup({ object, filename: file.name }); } catch (error) { notify(`无法读取备份：${errorMessage(error)}`, true); } if (inputRef.current) inputRef.current.value = ''; };
  const restore = async () => { if (!backup) return; setBusy(true); try { const result = await api<{ state: State }>('/backup', post({ backup: backup.object })); setState(result.state); api<AIConfig>('/ai/config').then(onAIConfigChange).catch(error => notify(errorMessage(error), true)); setBand(result.state.settings.targetBand); setBackup(null); notify('备份已恢复，工作台数据已更新。'); } catch (error) { notify(errorMessage(error), true); } finally { setBusy(false); } };
  return <><div className="page-heading"><div>{!nativeUI && <div className="eyebrow">A WORKBENCH THAT FITS YOU</div>}<h1>{nativeUI ? '设置' : <>偏好与数据<span className="heading-dot">.</span></>}</h1>{!nativeUI && <p>按照自己的节奏积累，让所有内容始终由你掌握。</p>}</div></div><div className="settings-grid"><section className="card settings-card"><div className="section-heading"><div><h2>学习目标</h2>{!nativeUI && <p>用于专属提示词与答案准备</p>}</div><Sprout size={22} /></div><label className="form-label">IELTS 目标分数<select value={band} onChange={event => setBand(event.target.value)}>{['5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0'].map(item => <option key={item} value={item}>{item} Band</option>)}</select></label><label className="form-label">考试类型<select value="academic" disabled><option value="academic">Academic 学术类</option></select>{!nativeUI && <small>General Training 小作文题库与专属处理器预留。</small>}</label><button className="button primary" disabled={busy} onClick={save}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{nativeUI ? '保存' : '保存学习偏好'}</button></section><AISettings apiOnly={apiOnly} config={aiConfig} onChange={onAIConfigChange} notify={notify} />{macClient && <MobileSettings />}<section className="card settings-card data-card"><div className="section-heading"><div><h2>{nativeUI ? '数据备份' : '你的积累，安全留在本机'}</h2>{!nativeUI && <p>导出备份，也可以在另一台设备恢复</p>}</div><FolderOpen size={22} /></div><div className="data-summary"><span><strong>{state.answers.length}</strong>答案</span><span><strong>{state.materials.length}</strong>素材元</span><span><strong>{state.expressions.length}</strong>表达</span><span><strong>{state.words.length}</strong>单词</span></div><div className="storage-path"><small>存储位置</small><code>{nativeUI ? '此 iPhone' : state.storage.location}</code></div><div className="settings-buttons"><button className="button primary" onClick={() => exportBackup()}><ArrowDownToLine size={16} />{nativeUI ? '导出备份' : '导出完整备份'}</button><button className="button secondary" onClick={() => inputRef.current?.click()}><Upload size={16} />导入备份</button><button className="button secondary" onClick={openBatch}><FileText size={16} />{nativeUI ? '导入题库' : 'PDF / Word 导入题库'}</button><button className="text-button" onClick={() => exportBackup(true)}><ArrowDownToLine size={14} />{nativeUI ? '恢复前备份' : '下载恢复前快照'}</button><input ref={inputRef} hidden type="file" accept=".json,application/json" onChange={event => readBackup(event.target.files?.[0])} /></div><p className="settings-explanation">{nativeUI ? '包含题库和全部积累，不含密钥或原件。' : '备份包括中文草稿、当前答案、素材、语料、关联、单词、AI 任务与学习偏好。'}</p></section>{!nativeUI && <section className="device-card"><div className="device-illustration"><div className="device-laptop"><div><span /> <span /> <span /></div></div><div className="device-phone"><span /></div></div><h3>两端独立积累，按需同步。</h3><p>iPhone 自带完整题库与本地学习库，独立刷题、整理和背诵。需要互通进度时再配对，选择以哪一端覆盖另一端；两端 API 密钥分别配置。</p><Pill tone="green">LOCAL FIRST · TWO DEVICES</Pill></section>}</div>{backup && <Modal title="恢复这份备份？" close={() => setBackup(null)}><p className="modal-description">文件：{backup.filename}</p><p className="restore-warning">{nativeUI ? '将替换全部学习数据，覆盖前会保留备份。' : '恢复会替换当前工作台的学习数据。建议先导出当前备份，校验通过后才会写入。'}</p><details className="preview-details"><summary>预览备份内容</summary><pre>{JSON.stringify(backup.object, null, 2).slice(0, 12000)}</pre></details><div className="modal-actions"><button className="button secondary" onClick={() => exportBackup()}><ArrowDownToLine size={16} />先备份当前数据</button><button className="button primary" disabled={busy} onClick={restore}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}确认恢复</button></div></Modal>}</>;
}
