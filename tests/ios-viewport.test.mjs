import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, iosVisibleBounds, installIOSViewport;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ iosVisibleBounds, installIOSViewport } = await vite.ssrLoadModule('/src/iosViewport.ts'));
});
after(async () => { await vite?.close(); });

test('keyboard-visible bounds fit inside the layout viewport even when WebKit reports excessive offsets', () => {
  const bounds = iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852, width: 393, height: 318, top: 800, left: 40 });
  assert.deepEqual(bounds, { width: 393, height: 318, top: 534, left: 0 });
  assert.ok(bounds.top + bounds.height <= 852);
  assert.ok(bounds.left + bounds.width <= 393);
  const zoomed = iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852, width: 280, height: 300, top: 220, left: 90 });
  assert.deepEqual(zoomed, { width: 280, height: 300, top: 220, left: 90 });
});

test('dismissing the keyboard clears stale viewport offsets instead of leaving an invisible top gap', () => {
  assert.deepEqual(iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852, width: 393, height: 852, top: 534, left: 18 }), { width: 393, height: 852, top: 0, left: 0 });
  assert.deepEqual(iosVisibleBounds({ layoutWidth: 852, layoutHeight: 393, width: 852, height: 393, top: 534, left: 113 }), { width: 852, height: 393, top: 0, left: 0 });
});

test('missing or invalid visual viewport values fall back to finite layout dimensions', () => {
  assert.deepEqual(iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852 }), { width: 393, height: 852, top: 0, left: 0 });
  assert.deepEqual(iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852, width: Infinity, height: NaN, top: Infinity, left: -70 }), { width: 393, height: 852, top: 0, left: 0 });
  assert.deepEqual(iosVisibleBounds({ layoutWidth: 393, layoutHeight: 852, width: 900, height: -3, top: -20, left: 900 }), { width: 393, height: 1, top: 0, left: 0 });
});

function surface() {
  const handlers = new Map();
  return {
    addEventListener(name, handler) { const items = handlers.get(name) || new Set(); items.add(handler); handlers.set(name, items); },
    removeEventListener(name, handler) { handlers.get(name)?.delete(handler); },
    emit(name) { for (const handler of handlers.get(name) || []) handler({ type: name }); },
    count() { return [...handlers.values()].reduce((total, items) => total + items.size, 0); },
  };
}
function fixture(t, { visual = true } = {}) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const frames = new Map(), writes = [], events = [], canceled = [];
  const cleanups = [];
  const css = new Map([['--unrelated-style', 'unchanged']]);
  let nextFrame = 0;
  const viewport = Object.assign(surface(), { width: 393, height: 852, offsetTop: 0, offsetLeft: 0 });
  const forbidden = () => { throw new Error('Viewport observation must not resize or scroll document content'); };
  const host = Object.assign(surface(), {
    innerWidth: 393, innerHeight: 852, visualViewport: visual ? viewport : undefined,
    scrollTo: forbidden, scrollBy: forbidden,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { canceled.push(id); frames.delete(id); },
    dispatchEvent(event) { events.push({ type: event.type, detail: event.detail }); },
  });
  const untouchedStyle = new Proxy({}, { set: forbidden, get: (_, key) => key === 'setProperty' || key === 'removeProperty' ? forbidden : undefined });
  const element = { style: untouchedStyle, scrollIntoView: forbidden };
  globalThis.window = host;
  globalThis.document = { body: element, querySelector: () => element, documentElement: { style: {
    setProperty(key, value) { assert.match(key, /^--ios-visible-(width|height|top|left)$/); css.set(key, value); writes.push([key, value]); },
  } } };
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  return {
    host, viewport, frames, writes, events, canceled, css,
    cleanup(callback) { cleanups.push(callback); },
    flush() { const queued = [...frames.entries()]; frames.clear(); for (const [, callback] of queued) callback(0); },
  };
}

test('viewport listeners update only fixed-overlay bounds and coalesce keyboard/scroll events into one frame', t => {
  const f = fixture(t), dispose = installIOSViewport();
  f.cleanup(dispose);
  assert.equal(f.writes.length, 4);
  assert.deepEqual(f.events, [{ type: 'yasy:viewport', detail: { width: 393, height: 852, top: 0, left: 0 } }]);
  f.viewport.height = 318; f.viewport.offsetTop = 350;
  f.viewport.emit('resize'); f.viewport.emit('scroll'); f.host.emit('resize'); f.viewport.emit('scroll');
  assert.equal(f.frames.size, 1);
  assert.equal(f.writes.length, 4);
  f.flush();
  assert.equal(f.writes.length, 8);
  assert.deepEqual(f.events.at(-1), { type: 'yasy:viewport', detail: { width: 393, height: 318, top: 350, left: 0 } });
  assert.equal(f.css.get('--ios-visible-height'), '318px');
  assert.equal(f.css.get('--unrelated-style'), 'unchanged');
  f.viewport.emit('scroll'); f.host.emit('resize'); f.flush();
  assert.equal(f.writes.length, 8, 'unchanged bounds do not trigger repeated styles or re-layout events');
  assert.equal(f.events.length, 2);
  f.viewport.height = 852; f.viewport.offsetTop = 350;
  f.viewport.emit('resize'); f.flush();
  assert.equal(f.css.get('--ios-visible-top'), '0px');
  assert.equal(f.css.get('--ios-visible-height'), '852px');
});

test('viewport teardown removes every listener and cancels a pending animation frame', t => {
  const f = fixture(t), dispose = installIOSViewport();
  assert.equal(f.host.count(), 1);
  assert.equal(f.viewport.count(), 2);
  f.viewport.height = 400;
  f.viewport.emit('resize');
  assert.equal(f.frames.size, 1);
  const scheduled = [...f.frames.keys()][0];
  dispose();
  assert.equal(f.host.count(), 0);
  assert.equal(f.viewport.count(), 0);
  assert.deepEqual(f.canceled, [scheduled]);
  assert.equal(f.frames.size, 0);
  const count = f.writes.length;
  f.host.emit('resize'); f.viewport.emit('resize'); f.viewport.emit('scroll'); f.flush();
  assert.equal(f.frames.size, 0);
  assert.equal(f.writes.length, count);
});

test('a window without visualViewport still provides bounded overlay dimensions and cleans up', t => {
  const f = fixture(t, { visual: false }), dispose = installIOSViewport();
  f.cleanup(dispose);
  assert.equal(f.css.get('--ios-visible-height'), '852px');
  f.host.innerWidth = 852; f.host.innerHeight = 393;
  f.host.emit('resize'); f.flush();
  assert.equal(f.css.get('--ios-visible-width'), '852px');
  assert.equal(f.css.get('--ios-visible-height'), '393px');
  assert.equal(f.css.get('--ios-visible-top'), '0px');
});
