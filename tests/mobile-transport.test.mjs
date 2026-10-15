import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Store } from '../server/store.mjs';

let vite, installMobileBackend;
const pageContexts = new WeakSet();
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ installMobileBackend } = await vite.ssrLoadModule('/src/mobileLocal/transport.ts'));
});
after(async () => { await vite?.close(); });

const bank = {
  sources: [{ id: 'transport-source', title: 'Phone transport fixture', url: 'https://ielts.org/', type: 'official', accessedAt: '2026-10-15', note: 'Automated test only.' }],
  topics: [{ id: 'transport-topic', scope: 'speaking', titleZh: '学习', titleEn: 'Learning', description: 'Fixture', tags: ['learning'] }],
  questions: [{ id: 'q', scope: 'speaking', topicId: 'transport-topic', sourceId: 'transport-source', sourceType: 'adapted', part: 'Part 1', titleZh: '学习英语', promptEn: 'Do you enjoy learning English?', promptZh: '你喜欢学英语吗？', tags: ['learning'] }],
};
const phoneDraft = '这是手机原来保存的中文素材，下一次同步前需要完整备份。';
const macDraft = '这是 Mac 上较新的中文素材，用户选择用这一份覆盖手机。';
const oldTimerDraft = '这是旧页面自动保存计时器中的内容，不能回写到刚覆盖的新进度。';
function snapshot(textZh) {
  const store = new Store({ file: ':memory:', bank });
  try { store.saveDraft('q', { textZh, materialIds: [] }); return store.backup(); }
  finally { store.close(); }
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function within(promise, label = 'operation') {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not finish while the native operation was held`)), 1500); })]); }
  finally { clearTimeout(timer); }
}
function nativeFixture(hooks = {}) {
  const observers = [];
  const native = {
    current: snapshot(phoneDraft), incoming: snapshot(macDraft), previous: null,
    calls: [], reloads: 0,
    wait(action, predicate = () => true) {
      const match = this.calls.find(call => call.action === action && predicate(call));
      if (match) return Promise.resolve(match);
      return new Promise(resolve => observers.push({ action, predicate, resolve }));
    },
    async handle(message) {
      this.calls.push(structuredClone(message));
      for (let i = observers.length - 1; i >= 0; i--) if (observers[i].action === message.action && observers[i].predicate(message)) {
        observers.splice(i, 1)[0].resolve(message);
      }
      const perform = () => {
        switch (message.action) {
          case 'storage.read': return structuredClone(this.current);
          case 'storage.write': this.current = structuredClone(message.body.value); return { ok: true };
          case 'storage.restore': this.previous = structuredClone(this.current); this.current = structuredClone(message.body.value); return { ok: true };
          case 'sync.pull': return structuredClone(this.incoming);
          case 'sync.feedback': return { ok: true };
          case 'ui.reload': this.reloads++; return { ok: true };
          default: throw new Error(`Unexpected native action ${message.action}`);
        }
      };
      return hooks[message.action] ? hooks[message.action](message, perform) : perform();
    },
  };
  return native;
}
async function page(t, native, beforeSync = async () => {}) {
  if (!pageContexts.has(t)) {
    pageContexts.add(t);
    const originalWindow = globalThis.window, originalDocument = globalThis.document;
    t.after(() => {
      if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    });
  }
  const listeners = new Map();
  const host = {
    location: { href: 'yasy-local://app/?client=ios&local=1', search: '?client=ios&local=1' },
    fetch: async () => { throw new Error('A local phone request must not contact a Mac or network'); },
    setTimeout,
    alert: message => { throw new Error(`Unexpected alert: ${message}`); },
    addEventListener: (name, handler) => { const handlers = listeners.get(name) || []; handlers.push(handler); listeners.set(name, handlers); },
    webkit: { messageHandlers: { yasyNative: { postMessage: message => {
      // The bridge replies asynchronously through the same WK callback used by
      // Swift, including held storage/feedback operations and native failures.
      void Promise.resolve().then(() => native.handle(message)).then(
        result => host.__yasyNativeReply(message.id, { result }),
        error => host.__yasyNativeReply(message.id, { error: { message: error.message, status: error.status || 500 } }),
      );
    } } } },
  };
  globalThis.window = host;
  globalThis.document = { addEventListener: () => {} };
  await installMobileBackend(beforeSync);
  return {
    host,
    sync(detail) { for (const handler of listeners.get('yasy:sync') || []) handler({ detail }); },
    async api(path, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await host.fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    },
  };
}
const writeOldDraft = p => p.api('/api/drafts/q', { textZh: oldTimerDraft, materialIds: [] }, 'PUT');
const draftIn = backup => backup.learning.drafts.find(draft => draft.questionId === 'q')?.textZh;

test('a delayed native restore blocks old timer writes and a reopened phone retains the Mac draft', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const native = nativeFixture({ 'storage.restore': async (_, perform) => { await release.promise; return perform(); } });
  let flushes = 0;
  const p = await page(t, native, async () => { flushes++; });
  p.sync({ direction: 'pull', confirmed: true, runId: 'pull-delayed-storage' });
  await within(native.wait('storage.restore'));
  const blocked = await within(writeOldDraft(p), 'stale autosave');
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /覆盖/);
  assert.equal(draftIn(native.current), phoneDraft);
  release.resolve();
  await within(native.wait('ui.reload'));
  assert.equal(flushes, 1);
  assert.equal(draftIn(native.current), macDraft);
  assert.equal(draftIn(native.previous), phoneDraft);
  assert.equal((await within(writeOldDraft(p))).status, 409);
  assert.equal(native.calls.find(call => call.action === 'sync.pull').body.runId, 'pull-delayed-storage');
  assert.equal(native.calls.find(call => call.action === 'sync.feedback').body.runId, 'pull-delayed-storage');
  const reopened = await page(t, native);
  const state = await reopened.api('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.drafts.find(draft => draft.questionId === 'q').textZh, macDraft);
  assert.equal(draftIn(native.current), macDraft);
});

test('a delayed sync feedback keeps the old document frozen after storage has already been replaced', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const native = nativeFixture({ 'sync.feedback': async (_, perform) => { await release.promise; return perform(); } });
  const p = await page(t, native);
  p.sync({ direction: 'pull', confirmed: true, runId: 'pull-delayed-feedback' });
  await within(native.wait('sync.feedback'));
  assert.equal(draftIn(native.current), macDraft);
  assert.equal(native.reloads, 0);
  assert.equal((await within(writeOldDraft(p))).status, 409);
  assert.equal(draftIn(native.current), macDraft);
  release.resolve();
  await within(native.wait('ui.reload'));
  assert.equal((await within(writeOldDraft(p))).status, 409);
  const reopened = await page(t, native);
  assert.equal((await reopened.api('/api/state')).data.drafts[0].textZh, macDraft);
});

test('manual backup restore freezes autosaves through the native write and until document reload', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const native = nativeFixture({ 'storage.restore': async (_, perform) => { await release.promise; return perform(); } });
  const p = await page(t, native);
  const restoring = p.api('/api/backup', { backup: native.incoming });
  await within(native.wait('storage.restore'));
  assert.equal((await within(writeOldDraft(p))).status, 409);
  release.resolve();
  assert.equal((await within(restoring)).status, 200);
  await within(native.wait('ui.reload'));
  assert.equal(draftIn(native.current), macDraft);
  assert.equal(draftIn(native.previous), phoneDraft);
  assert.equal((await within(writeOldDraft(p))).status, 409);
});

test('a failed native sync restore rolls back the phone data and unfreezes normal editing', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const native = nativeFixture({ 'storage.restore': async () => { await release.promise; throw new Error('Fixture storage write failed'); } });
  const p = await page(t, native);
  p.sync({ direction: 'pull', confirmed: true, runId: 'pull-storage-failure' });
  await within(native.wait('storage.restore'));
  assert.equal((await within(writeOldDraft(p))).status, 409);
  release.resolve();
  const feedback = await within(native.wait('sync.feedback', call => call.body.error === true));
  assert.match(feedback.body.message, /storage write failed/);
  assert.equal(draftIn(native.current), phoneDraft);
  assert.equal(native.previous, null);
  assert.equal(native.reloads, 0);
  const saved = await within(p.api('/api/drafts/q', { textZh: '恢复失败后仍可以继续写新的中文素材。', materialIds: [] }, 'PUT'));
  assert.equal(saved.status, 200);
  assert.equal(draftIn(native.current), '恢复失败后仍可以继续写新的中文素材。');
});

test('a failed manual backup restore unfreezes editing and retains the last durable draft', async t => {
  const native = nativeFixture({ 'storage.restore': async () => { throw new Error('Fixture restore failed'); } });
  const p = await page(t, native);
  const restore = await p.api('/api/backup', { backup: native.incoming });
  assert.equal(restore.status, 500);
  assert.equal(draftIn(native.current), phoneDraft);
  assert.equal(native.reloads, 0);
  assert.equal((await within(p.api('/api/drafts/q', { textZh: '失败后继续编辑。', materialIds: [] }, 'PUT'))).status, 200);
  assert.equal(draftIn(native.current), '失败后继续编辑。');
});

test('a rejected duplicate sync event cannot release another active restore freeze', async t => {
  const release = deferred();
  t.after(() => release.resolve());
  const native = nativeFixture({ 'storage.restore': async (_, perform) => { await release.promise; return perform(); } });
  const p = await page(t, native);
  p.sync({ direction: 'pull', confirmed: true, runId: 'owner' });
  await within(native.wait('storage.restore'));
  p.sync({ direction: 'pull', confirmed: true, runId: 'duplicate' });
  await within(native.wait('sync.feedback', call => call.body.runId === 'duplicate' && call.body.error === true));
  assert.equal((await within(writeOldDraft(p), 'autosave after rejected duplicate')).status, 409);
  release.resolve();
  await within(native.wait('ui.reload'));
  assert.equal(draftIn(native.current), macDraft);
  assert.equal(native.calls.filter(call => call.action === 'sync.pull').length, 1);
});
