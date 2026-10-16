import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, IOSSheet, isNativeIOS, manageSheetFocus, Workspace, Modal, BatchImport, ExpressionDetail;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ IOSSheet, isNativeIOS, manageSheetFocus } = await vite.ssrLoadModule('/src/IOSSheet.tsx'));
  ({ Workspace, Modal } = await vite.ssrLoadModule('/src/App.tsx'));
  ({ default: BatchImport } = await vite.ssrLoadModule('/src/BatchImport.tsx'));
  ({ ExpressionDetail } = await vite.ssrLoadModule('/src/ReadingDetails.tsx'));
});
after(async () => { await vite?.close(); });
function inClient(search, action) {
  const previous = globalThis.window;
  globalThis.window = { location: { search } };
  try { return action(); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}
const question = { id: 'q1', scope: 'speaking', topicId: 't1', sourceId: 'source', sourceType: 'reported', titleZh: '旅行经历', promptEn: 'Describe a memorable trip.', promptZh: '描述一次难忘的旅行。', part: 'Part 2', cuePoints: ['Where you went', 'Who you went with'], tags: ['travel'], basis: 'PDF physical page 12' };
function workspaceProps(extra = {}) {
  const state = { questions: [question], archivedQuestions: [], sources: [{ id: 'source', title: 'Source document', url: '/api/sources/source/file' }], topics: [], drafts: [], answers: [], jobs: [], materials: [], expressions: [], words: [], links: [], settings: { targetBand: '7.0', provider: 'iiiapi' } };
  return { question, state, prefill: [], reload: async () => state, notify() {}, goBack() {}, openQuestion() {}, addWord() {}, onMaterial() {}, onExpression() {}, aiConfig: { provider: 'iiiapi', hasKey: true, model: 'fixture-model' }, registerJob() {}, runBackground: async () => {}, questionBusy: false, apiMode: true, iosClient: true, onSettings() {}, ...extra };
}

test('only the explicit native client enables the iOS presentation', () => {
  assert.equal(inClient('', () => isNativeIOS()), false);
  assert.equal(inClient('?client=ios&local=1', () => isNativeIOS()), true);
});
test('native practice uses three short equal-step controls and keeps source text folded', () => {
  const html = inClient('?client=ios', () => renderToStaticMarkup(h(Workspace, workspaceProps())));
  assert.match(html, /aria-label="练习步骤"/);
  assert.equal((html.match(/class="ios-workflow-number"/g) || []).length, 3);
  assert.match(html, /<details class="ios-question-details"><summary>/);
  assert.doesNotMatch(html, /<details class="ios-question-details" open/);
  assert.match(html, /Describe a memorable trip\./); assert.match(html, /PDF physical page 12/);
  assert.match(html, /生成答案/); assert.match(html, /帮我想素材/);
  assert.doesNotMatch(html, /AI 整理与提取|从一个粗略想法开始|中文助写独立调用|workspace-tip|editor-provider-note/);
});
test('Mac and narrow Mac keep the original long step labels and editor guidance', () => {
  const html = inClient('', () => renderToStaticMarkup(h(Workspace, workspaceProps({ iosClient: true }))));
  assert.match(html, /写下中文素材/); assert.match(html, /AI 整理与提取/); assert.match(html, /答案与积累/);
  assert.match(html, /从一个粗略想法开始/); assert.match(html, /editor-provider-note/);
  assert.doesNotMatch(html, /ios-workflow-tabs|ios-question-details/);
});
test('a restored editor step remains the editor even when this question already has an answer', () => {
  const props = workspaceProps(); props.state.answers = [{ id: 'a1', questionId: question.id, textEn: 'A saved answer.', wordCount: 3, materialIds: [], expressionIds: [] }];
  props.initialStep = 'write';
  const html = inClient('?client=ios', () => renderToStaticMarkup(h(Workspace, props)));
  assert.match(html, /中文素材编辑器/); assert.doesNotMatch(html, /A saved answer\./);
});
test('a long idea preview has one scrollable body and its confirmation outside that body', () => {
  const html = renderToStaticMarkup(h(IOSSheet, { title: '中文素材草稿', close() {} }, h(Fragment, null,
    h('div', { className: 'ideas-draft-preview' }, '很长的素材。'.repeat(300)),
    h('div', { className: 'modal-actions' }, h('button', null, '保留当前草稿'), h('button', null, '填入素材')))));
  assert.equal((html.match(/class="ios-sheet-body"/g) || []).length, 1);
  assert.match(html, /<footer class="ios-sheet-footer"><div class="modal-actions">/);
  assert.ok(html.indexOf('class="ideas-draft-preview"') < html.indexOf('<footer'));
  assert.ok(html.indexOf('填入素材') > html.indexOf('<footer'));
});
test('word collection keeps the submit button inside the same form as the input', () => {
  const html = renderToStaticMarkup(h(IOSSheet, { title: '收进单词本', close() {} }, h('form', { id: 'word-form', onSubmit() {} },
    h('input', { name: 'word', defaultValue: 'confidence' }), h('div', { className: 'modal-actions' }, h('button', { type: 'submit' }, '收藏')))));
  assert.match(html, /<form id="word-form" class=" ios-sheet-form">/);
  assert.ok(html.indexOf('<form') < html.indexOf('class="ios-sheet-body"'));
  assert.ok(html.indexOf('<footer') < html.indexOf('type="submit"'));
  assert.ok(html.indexOf('type="submit"') < html.indexOf('</form>'));
});
test('the Mac dialog retains the legacy DOM without sheet wrappers', () => {
  const html = inClient('', () => renderToStaticMarkup(h(Modal, { title: '确认', close() {} }, h('p', null, '原有正文'))));
  assert.match(html, /class="modal-overlay"/); assert.match(html, /class="modal "/);
  assert.doesNotMatch(html, /ios-sheet|<footer/);
});
test('native reading and batch dialogs both use the bounded sheet regions', () => {
  const expression = { id: 'e1', scope: 'speaking', textEn: 'build confidence', meaningZh: '建立信心', exampleEn: 'Practice helps build confidence.', categoryEn: 'Collocation', admission: { status: 'approved' } };
  const expressionHTML = inClient('?client=ios', () => renderToStaticMarkup(h(ExpressionDetail, { expression, close() {}, addWord() {} })));
  assert.match(expressionHTML, /ios-sheet-body/); assert.match(expressionHTML, /<footer class="ios-sheet-footer">/);
  assert.ok(expressionHTML.indexOf('Add to vocabulary') > expressionHTML.indexOf('<footer'));
  const batchHTML = inClient('?client=ios', () => renderToStaticMarkup(h(BatchImport, { apiMode: true, close() {}, notify() {}, onSaved() {} })));
  assert.match(batchHTML, /ios-sheet-body/); assert.match(batchHTML, /ios-sheet-footer/);
  assert.ok(batchHTML.indexOf('保存文件，继续整理') > batchHTML.indexOf('<footer'));
});

function generateButton(html, label) {
  const match = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(item => item[2].includes(label));
  assert.ok(match, `Expected ${label} button`);
  return { disabled: /\bdisabled(?:=|\s|$)/.test(match[1]) };
}
function task1Props(visual) {
  const props = workspaceProps();
  props.question = { ...question, scope: 'writing-task1', part: '', taskType: 'Table', promptEn: 'Summarise the information by selecting and reporting the main features, and make comparisons where relevant.', visual };
  props.state.questions = [props.question];
  return props;
}
test('native Task 1 can generate from complete visual data with empty notes', () => {
  const visual = { kind: 'table', title: 'Attendance', columns: ['Year', 'People'], rows: [['2020', 100], ['2021', 150]], steps: [], note: 'Number of people' };
  const html = inClient('?client=ios', () => renderToStaticMarkup(h(Workspace, task1Props(visual))));
  assert.equal(generateButton(html, '生成答案').disabled, false);
});
test('native Task 1 with neither a usable visual nor notes cannot generate', () => {
  const html = inClient('?client=ios', () => renderToStaticMarkup(h(Workspace, task1Props(undefined))));
  assert.equal(generateButton(html, '生成答案').disabled, true);
});
test('Mac Task 1 keeps requiring notes even with complete visual data', () => {
  const visual = { kind: 'table', title: 'Attendance', columns: ['Year', 'People'], rows: [['2020', 100], ['2021', 150]], steps: [], note: 'Number of people' };
  const html = inClient('', () => renderToStaticMarkup(h(Workspace, task1Props(visual))));
  assert.equal(generateButton(html, '交给 AI 后台整理').disabled, true);
});

// Minimal DOM fixture: exercise the actual focus controller without mounting the
// app, installing a browser dependency, or contacting the native/API transport.
function focusFixture() {
  const listeners = new Map();
  const document = { activeElement: null, defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) },
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); },
    fire(type, data = {}) { const event = { prevented: false, preventDefault() { this.prevented = true; }, ...data }; for (const fn of [...(listeners.get(type) || [])]) fn(event); return event; } };
  class Element {
    constructor(name, options = {}) { Object.assign(this, { name, ownerDocument: document, isConnected: true, tabIndex: 0, children: [], parent: null, calls: [], isContentEditable: false }, options); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } return this; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll() { return this.descendants(); }
    querySelector(selector) { return this.descendants().find(child => selector === '[autofocus]' ? child.autofocus : child.close) || null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    matches(selector) { return selector.startsWith(':disabled') ? !!this.disabled : !!this.editable; }
    closest(selector) { for (let current = this; current; current = current.parent) if (selector === '[role="dialog"]' ? current.dialog : current.hidden) return current; return null; }
    focus(options) { this.calls.push(options); document.activeElement = this; document.fire('focusin', { target: this }); }
  }
  const previous = globalThis.HTMLElement; globalThis.HTMLElement = Element;
  return { document, Element, restore() { if (previous === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previous; } };
}
test('sheet focus starts inside, cycles Tab in both directions, and blocks background focus', () => {
  const f = focusFixture();
  try {
    const opener = new f.Element('opener'), sheet = new f.Element('sheet', { dialog: true, tabIndex: -1 });
    const close = new f.Element('close', { close: true }), input = new f.Element('input', { editable: true }), disabled = new f.Element('disabled', { disabled: true }), save = new f.Element('save');
    sheet.append(close, input, disabled, save); f.document.activeElement = opener;
    const release = manageSheetFocus(sheet, () => true, opener);
    assert.equal(f.document.activeElement, close); assert.deepEqual(close.calls[0], { preventScroll: true });
    save.focus(); assert.equal(f.document.fire('keydown', { key: 'Tab', shiftKey: false }).prevented, true); assert.equal(f.document.activeElement, close);
    assert.equal(f.document.fire('keydown', { key: 'Tab', shiftKey: true }).prevented, true); assert.equal(f.document.activeElement, save);
    opener.focus(); assert.equal(f.document.activeElement, close);
    release(); assert.equal(f.document.activeElement, opener);
  } finally { f.restore(); }
});
test('word autofocus is retained and only the top nested sheet traps focus', () => {
  const f = focusFixture();
  try {
    let top = 'parent';
    const opener = new f.Element('opener'), parent = new f.Element('parent', { dialog: true, tabIndex: -1 }), parentClose = new f.Element('parentClose', { close: true }); parent.append(parentClose);
    f.document.activeElement = opener; const releaseParent = manageSheetFocus(parent, () => top === 'parent', opener);
    const child = new f.Element('child', { dialog: true, tabIndex: -1 }), close = new f.Element('childClose', { close: true }), word = new f.Element('word', { editable: true, autofocus: true }), save = new f.Element('save'); child.append(close, word, save);
    top = 'child'; word.focus(); const releaseChild = manageSheetFocus(child, () => top === 'child', parentClose);
    assert.equal(f.document.activeElement, word); assert.equal(close.calls.length, 0);
    save.focus(); f.document.fire('keydown', { key: 'Tab', shiftKey: false }); assert.equal(f.document.activeElement, close);
    top = 'parent'; releaseChild(); assert.equal(f.document.activeElement, parentClose);
    releaseParent(); assert.equal(f.document.activeElement, opener);
  } finally { f.restore(); }
});
test('closing a sheet never focuses the prior editable field and reopens its keyboard', () => {
  const f = focusFixture();
  try {
    const editor = new f.Element('editor', { editable: true }), sheet = new f.Element('sheet', { dialog: true, tabIndex: -1 }), close = new f.Element('close', { close: true }); sheet.append(close);
    f.document.activeElement = editor; const release = manageSheetFocus(sheet, () => true, editor); release();
    assert.equal(editor.calls.length, 0); assert.notEqual(f.document.activeElement, editor);
  } finally { f.restore(); }
});
