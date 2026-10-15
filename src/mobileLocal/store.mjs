import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import { createStoreClass } from '../../server/store-core.mjs';
import seed from '../../data/question-bank.json';
const engine = initSqlJs();

export async function createLocalStore({ load = async () => null, save = async () => {}, bank = seed } = {}) {
  const SQL = await engine;
  class DatabaseSync {
    constructor() { this.database = new SQL.Database(); }
    exec(sql) { this.database.exec(sql); }
    prepare(sql) {
      const rows = values => {
        const statement = this.database.prepare(sql);
        try { statement.bind(values.map(value => value === undefined ? null : value)); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
        finally { statement.free(); }
      };
      return { all: (...values) => rows(values), get: (...values) => rows(values)[0],
        run: (...values) => { this.database.run(sql, values.map(value => value === undefined ? null : value)); return { changes: this.database.getRowsModified() }; } };
    }
    checkpoint() { return this.database.export(); }
    rollback(bytes) { this.database.close(); this.database = new SQL.Database(bytes); this.database.exec('PRAGMA foreign_keys=ON;'); }
    close() { this.database.close(); }
  }
  const forbiddenIO = () => { throw new Error('独立手机客户端不会读取 Mac 文件系统。'); };
  const MemoryStore = createStoreClass({ DatabaseSync, mkdirSync: forbiddenIO, readFileSync: forbiddenIO, existsSync: () => false,
    resolve: (...parts) => parts.join('/'), dirname: () => '' });
  const store = new MemoryStore({ file: ':memory:', bank });
  const saved = await load();
  if (saved) store.restore(saved);
  store.setSettings({ provider: 'iiiapi' });
  const state = store.state.bind(store);
  store.state = () => ({ ...state(), storage: { kind: 'iPhone 本地', location: '此 iPhone · Application Support' } });
  const fork = () => { const copy = new MemoryStore({ file: ':memory:', bank }); copy.db.rollback(store.db.checkpoint()); return copy; };
  return { store, checkpoint: () => store.db.checkpoint(), rollback: value => store.db.rollback(value), fork,
    persist: (restoring = false) => save(store.backup(), restoring) };
}
