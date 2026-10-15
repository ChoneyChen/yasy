import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../server/store.mjs';
import { clearFirstUseFromBackup } from '../server/learning-cleanup.mjs';

const tables = ['materials', 'material_revisions', 'expressions', 'answers', 'revisions', 'words', 'drafts', 'jobs', 'plans', 'batch_jobs', 'review_states', 'review_events'];

/** A dry run must not execute Store's schema, seeds or legacy migrations. */
export function readLearningBackup(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('BEGIN');
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const all = table => names.has(table) ? db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data)) : [];
    const settings = db.prepare("SELECT data FROM settings WHERE key='main'").get();
    if (!settings) throw new Error('Missing settings');
    const links = [
      ...db.prepare('SELECT material_id AS fromId,question_id AS toId,score,reason FROM material_questions').all().map(link => ({ ...link, kind: 'material-question' })),
      ...db.prepare('SELECT material_id AS fromId,expression_id AS toId,score,reason FROM material_expressions').all().map(link => ({ ...link, kind: 'material-expression' })),
    ];
    const backup = { format: 'yasy-backup', version: 1, exportedAt: new Date().toISOString(), bank: Object.fromEntries(['sources', 'topics', 'questions'].map(table => [table, all(table)])), learning: { ...Object.fromEntries(tables.map(table => [table, all(table)])), links, settings: JSON.parse(settings.data) } };
    db.exec('COMMIT');
    return backup;
  } finally { db.close(); }
}

function argumentsFor(argv) {
  const options = { apply: false, file: resolve(process.env.YASY_DATA_DIR || '.local', 'yasy.sqlite'), expectedQuestionId: undefined };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--apply') options.apply = true;
    else if (argv[index] === '--dry-run') options.apply = false;
    else if (argv[index] === '--db' && argv[index + 1]) options.file = resolve(argv[++index]);
    else if (argv[index] === '--question-id' && argv[index + 1]) options.expectedQuestionId = argv[++index];
    else throw new Error('Unknown argument');
  }
  return options;
}
const comparable = backup => JSON.stringify({ bank: backup.bank, learning: backup.learning });
const dateForFile = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).replaceAll('-', '');

export function runFirstUseCleanup(argv = process.argv.slice(2), log = console.log) {
  const options = argumentsFor(argv);
  if (!existsSync(options.file)) { log('没有学习数据库，无需清理。'); return { applied: false, target: null }; }
  const before = readLearningBackup(options.file);
  const filtered = clearFirstUseFromBackup(before, options);
  if (!filtered.target) { log('没有首次任务记录，无需清理。'); return { applied: false, target: null }; }
  log(`目标题：${filtered.target.questionId} · ${filtered.target.titleZh}`);
  log(`移除计数：${JSON.stringify(filtered.removed)}`);
  if (!options.apply) { log('预览完成，未修改数据库。确认后以 --apply 执行；可用 --question-id 锁定此目标。'); return { applied: false, ...filtered }; }
  if (before.learning.jobs.some(job => job.status === 'processing') || before.learning.batch_jobs.some(job => job.status === 'processing')) throw new Error('Processing work must finish first');
  const directory = join(dirname(options.file), 'backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const at = new Date();
  const backupPath = join(directory, `before-first-use-cleanup-${dateForFile(at)}-${at.getTime()}.json`);
  writeFileSync(backupPath, JSON.stringify(before, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(backupPath, 0o600);
  log(`恢复备份：${backupPath}`);
  const store = new Store({ file: options.file, bank: before.bank });
  try {
    if (comparable(store.backup()) !== comparable(before)) throw new Error('Learning data changed since preview');
    store.restore(filtered.backup);
  } finally { store.close(); }
  log('首次学习记录已清理；可从界面的恢复前快照或上述 JSON 备份恢复。');
  return { applied: true, backupPath, ...filtered };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  try { runFirstUseCleanup(); }
  catch { console.error('清理未完成。请停止 Yasy、等待后台任务结束，并核对参数或数据库状态后重新预览；已生成的备份仍可恢复。'); process.exitCode = 1; }
}
