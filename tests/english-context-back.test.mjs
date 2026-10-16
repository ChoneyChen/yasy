import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, installNativeWordMenuBack;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ installNativeWordMenuBack } = await vite.ssrLoadModule('/src/EnglishContext.tsx'));
});
after(async () => { await vite?.close(); });

function fixture(t, search = '?client=ios&local=1') {
  const original = globalThis.window;
  const listeners = [];
  const host = {
    location: { search },
    addEventListener(type, listener, capture = false) { listeners.push({ type, listener, capture }); },
    removeEventListener(type, listener, capture = false) {
      const index = listeners.findIndex(item => item.type === type && item.listener === listener && item.capture === capture);
      if (index !== -1) listeners.splice(index, 1);
    },
  };
  globalThis.window = host;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  return {
    host, listeners,
    // DOM listeners at the target execute capture listeners before ordinary
    // listeners. Node's flat EventTarget does not emulate that browser order.
    dispatch() {
      const event = new Event('yasy:dismiss-sheet', { cancelable: true });
      let stopped = false;
      const stop = event.stopImmediatePropagation.bind(event);
      event.stopImmediatePropagation = () => { stopped = true; stop(); };
      for (const phase of [true, false]) for (const item of [...listeners]) {
        if (stopped) break;
        if (item.type === event.type && item.capture === phase) item.listener(event);
      }
      return event;
    },
  };
}

test('native Back closes the top vocabulary popover before an underlying sheet or route', t => {
  const f = fixture(t);
  let menuOpen = true, menuCloses = 0, sheetCloses = 0, routeBacks = 0;
  // Even a sheet listener registered earlier must yield to the higher menu.
  const sheet = event => { sheetCloses++; event.preventDefault(); event.stopImmediatePropagation(); };
  f.host.addEventListener('yasy:dismiss-sheet', sheet);
  const remove = installNativeWordMenuBack(() => menuOpen, () => { menuOpen = false; menuCloses++; });
  const first = f.dispatch();
  if (!first.defaultPrevented) routeBacks++;
  assert.equal(first.defaultPrevented, true);
  assert.equal(menuCloses, 1);
  assert.equal(sheetCloses, 0);
  assert.equal(routeBacks, 0);

  const second = f.dispatch();
  if (!second.defaultPrevented) routeBacks++;
  assert.equal(menuCloses, 1);
  assert.equal(sheetCloses, 1);
  assert.equal(routeBacks, 0);
  f.host.removeEventListener('yasy:dismiss-sheet', sheet);
  const third = f.dispatch();
  if (!third.defaultPrevented) routeBacks++;
  assert.equal(third.defaultPrevented, false);
  assert.equal(routeBacks, 1);
  remove();
});

test('the native dismiss handler reads current menu state rather than a mount-time snapshot', t => {
  const f = fixture(t);
  let menuOpen = false, closed = 0;
  const remove = installNativeWordMenuBack(() => menuOpen, () => { menuOpen = false; closed++; });
  assert.equal(f.dispatch().defaultPrevented, false);
  menuOpen = true;
  assert.equal(f.dispatch().defaultPrevented, true);
  assert.equal(closed, 1);
  // A second Back can immediately reach the underlying page without waiting
  // for React to commit the popover's state update.
  assert.equal(f.dispatch().defaultPrevented, false);
  menuOpen = true;
  assert.equal(f.dispatch().defaultPrevented, true);
  assert.equal(closed, 2);
  remove();
});

test('desktop and narrow desktop clients do not gain a native-back listener', t => {
  const f = fixture(t, '');
  for (const search of ['', '?local=1', '?client=mac']) {
    f.host.location.search = search;
    let closed = 0;
    const remove = installNativeWordMenuBack(() => true, () => { closed++; });
    assert.equal(f.listeners.length, 0);
    assert.equal(f.dispatch().defaultPrevented, false);
    assert.equal(closed, 0);
    remove();
  }
});

test('unmount removes the same capture listener and no longer consumes Back events', t => {
  const f = fixture(t);
  let closed = 0;
  const remove = installNativeWordMenuBack(() => true, () => { closed++; });
  assert.equal(f.listeners.length, 1);
  assert.equal(f.listeners[0].capture, true);
  remove();
  assert.equal(f.listeners.length, 0);
  assert.equal(f.dispatch().defaultPrevented, false);
  assert.equal(closed, 0);
});
