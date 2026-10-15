import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createStoreClass } from './store-core.mjs';
const CoreStore = createStoreClass({ DatabaseSync, mkdirSync, readFileSync, existsSync, resolve, dirname });
export class Store extends CoreStore {
  constructor(options = {}) { super({ file: resolve(process.env.YASY_DATA_DIR || '.local', 'yasy.sqlite'), ...options }); }
}
