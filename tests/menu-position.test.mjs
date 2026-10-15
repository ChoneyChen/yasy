import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let positionMenu, visualBottomOffset;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ positionMenu, visualBottomOffset } = await server.ssrLoadModule('/src/menuPosition.ts'));
});
after(async () => { await server?.close(); });

test('a menu at the lower right remains fully inside the viewport', () => {
  const result = positionMenu({ x: 380, y: 830 }, { width: 300, height: 200 }, { left: 0, top: 0, width: 390, height: 844 });
  assert.deepEqual(result, { left: 78, top: 632, maxWidth: 366, maxHeight: 820 });
  assert.equal(result.left + 300, 390 - 12);
  assert.equal(result.top + 200, 844 - 12);
});

test('the actual native tab bar occlusion is reserved only once', () => {
  const result = positionMenu({ x: 380, y: 830 }, { width: 300, height: 500 }, { left: 0, top: 0, width: 390, height: 844 }, 89);
  assert.deepEqual(result, { left: 78, top: 243, maxWidth: 366, maxHeight: 731 });
  assert.equal(result.top + 500, 844 - 89 - 12);
});

test('an enlarged menu gets scrollable bounds rather than extending under the keyboard', () => {
  const result = positionMenu({ x: 380, y: 830 }, { width: 500, height: 900 }, { left: 0, top: 0, width: 390, height: 400 });
  assert.deepEqual(result, { left: 12, top: 12, maxWidth: 366, maxHeight: 376 });
});

test('visual viewport offsets are included when the page is zoomed or panned', () => {
  const result = positionMenu({ x: 350, y: 560 }, { width: 280, height: 220 }, { left: 45, top: 120, width: 320, height: 280 });
  assert.deepEqual(result, { left: 73, top: 168, maxWidth: 296, maxHeight: 256 });
  assert.ok(result.left >= 45 + 12 && result.top >= 120 + 12);
  assert.ok(result.left + 280 <= 45 + 320 - 12);
  assert.ok(result.top + 220 <= 120 + 280 - 12);
});

test('a hidden native tab bar does not subtract stale space from the keyboard viewport', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 400 };
  const visible = positionMenu({ x: 200, y: 390 }, { width: 300, height: 200 }, viewport, 89);
  const hidden = positionMenu({ x: 200, y: 390 }, { width: 300, height: 200 }, viewport, 0);
  assert.equal(hidden.maxHeight - visible.maxHeight, 89);
  assert.equal(hidden.top + 200, 388);
});

test('rotation recomputes available dimensions without retaining the old narrow bounds', () => {
  const anchor = { x: 830, y: 380 };
  const size = { width: 300, height: 250 };
  const portrait = positionMenu(anchor, size, { left: 0, top: 0, width: 390, height: 844 });
  const landscape = positionMenu(anchor, size, { left: 0, top: 0, width: 844, height: 390 });
  assert.equal(portrait.maxWidth, 366);
  assert.equal(landscape.maxWidth, 820);
  assert.equal(landscape.left + size.width, 832);
  assert.equal(landscape.top + size.height, 378);
});

test('degenerate native viewport values still yield finite nonnegative bounds', () => {
  const result = positionMenu({ x: NaN, y: Infinity }, { width: -1, height: NaN }, { left: -20, top: NaN, width: 8, height: 10 }, Infinity);
  assert.deepEqual(result, { left: 4, top: 5, maxWidth: 0, maxHeight: 0 });
  const covered = positionMenu({ x: 50, y: 50 }, { width: 300, height: 200 }, { left: 0, top: 0, width: 100, height: 80 }, 100);
  assert.equal(covered.maxHeight, 0);
  assert.equal(covered.top, 0);
});

test('fixed-overlay keyboard offset uses the visual viewport without affecting document layout', () => {
  assert.equal(visualBottomOffset(844, { top: 0, height: 500 }), 344);
  assert.equal(visualBottomOffset(844, { top: 100, height: 500 }), 244);
  assert.equal(visualBottomOffset(500, { top: 0, height: 500 }), 0);
  assert.equal(visualBottomOffset(500, { top: 0, height: 844 }), 0);
});
