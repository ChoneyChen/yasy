import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, createIOSRouteHistory, nativeBackTicket;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ createIOSRouteHistory, nativeBackTicket } = await vite.ssrLoadModule('/src/iosNavigation.ts'));
});
after(async () => { await vite?.close(); });

const root = (view, current = {}) => ({ view, questionId: null, questionPrefill: [], writingScope: current.writingScope || 'writing-task2', practiceKind: null, practiceResult: null, practiceError: '', workspaceStep: undefined, scrollY: 0 });
function questionRoute(view, overrides = {}) {
  return { ...root(view), questionId: `${view}-question`, workspaceStep: 'write', scrollY: 721,
    ...(view === 'today' ? { practiceKind: 'speaking', practiceResult: { reason: 'ready', question: { id: 'today-question' }, remaining: 6, waiting: 1 } } : {}), ...overrides };
}

test('settings returns to the complete daily-practice or library-question route, including step and scroll', () => {
  const cases = [
    questionRoute('today', { practiceError: 'A retained practice message', workspaceStep: 'write' }),
    questionRoute('today', { questionId: 'essay-question', practiceKind: 'writing', writingScope: 'writing-task2', workspaceStep: 'bridge', scrollY: 1042 }),
    questionRoute('speaking', { workspaceStep: 'answer', scrollY: 347 }),
    questionRoute('writing', { writingScope: 'writing-task1', workspaceStep: 'write', scrollY: 812 }),
  ];
  for (const origin of cases) {
    const history = createIOSRouteHistory(root);
    const original = structuredClone(origin);
    const settings = history.select(origin, 'settings');
    assert.equal(settings.view, 'settings');
    assert.equal(settings.questionId, null);
    assert.equal(settings.practiceKind, null);
    assert.equal(settings.scrollY, 0);
    assert.deepEqual(history.settingsOrigin(), original);
    assert.deepEqual(history.back(settings), original);
    assert.equal(history.settingsOrigin(), undefined);
    assert.deepEqual(origin, original, 'navigation does not modify the route being left');
  }
});

test('opening settings repeatedly keeps its original question instead of returning to settings itself', () => {
  const history = createIOSRouteHistory(root);
  const origin = questionRoute('today');
  const first = history.select(origin, 'settings');
  const scrolledSettings = { ...first, scrollY: 480 };
  const repeated = history.select(scrolledSettings, 'settings');
  assert.equal(repeated, scrolledSettings);
  assert.equal(history.settingsOrigin(), origin);
  assert.deepEqual(history.back(repeated), origin);
});

test('selecting another tab from settings restores that tab and leaves the original tab cached', () => {
  const history = createIOSRouteHistory(root);
  const daily = questionRoute('today', { scrollY: 510 });
  const speakingRoot = history.select(daily, 'speaking');
  const speaking = questionRoute('speaking', { workspaceStep: 'answer', scrollY: 1210 });
  assert.equal(speakingRoot.questionId, null);
  assert.deepEqual(history.select(speaking, 'today'), daily);
  const settings = history.select(daily, 'settings');
  assert.deepEqual(history.select(settings, 'speaking'), speaking);
  assert.equal(history.settingsOrigin(), undefined);
  assert.deepEqual(history.select(speaking, 'today'), daily);
});

test('reselecting an ordinary tab returns to its root and does not resurrect its previous question', () => {
  const history = createIOSRouteHistory(root);
  const current = questionRoute('today');
  const dailyRoot = history.select(current, 'today');
  assert.deepEqual(dailyRoot, root('today', current));
  const words = history.select(dailyRoot, 'words');
  assert.deepEqual(history.select(words, 'today'), dailyRoot);
  assert.equal(history.back(questionRoute('writing', { writingScope: 'writing-task1' })).writingScope, 'writing-task1');
  assert.equal(history.back(questionRoute('writing')).questionId, null);
});

test('consumed material prefill stays consumed through repeated settings and tab round trips', () => {
  const history = createIOSRouteHistory(root);
  // App captures routes after prefill has become the saved/pending Chinese
  // draft. Reopening the route must never replay an earlier suggestion array.
  const consumed = questionRoute('today', { questionPrefill: [], questionId: 'reused-material-question' });
  let current = consumed;
  for (let pass = 0; pass < 3; pass++) {
    current = history.back(history.select(current, 'settings'));
    assert.deepEqual(current.questionPrefill, []);
    const other = history.select(current, 'writing');
    current = history.select(other, 'today');
    assert.deepEqual(current.questionPrefill, []);
    assert.equal(current.questionId, consumed.questionId);
    assert.equal(current.workspaceStep, 'write');
    assert.equal(current.scrollY, consumed.scrollY);
  }
});

test('different tab snapshots can retain different steps for the same question ID', () => {
  const history = createIOSRouteHistory(root);
  const today = questionRoute('today', { questionId: 'shared-question', workspaceStep: 'write', scrollY: 320 });
  const speaking = questionRoute('speaking', { questionId: 'shared-question', workspaceStep: 'answer', scrollY: 980 });
  history.select(today, 'speaking');
  assert.deepEqual(history.select(speaking, 'today'), today);
  assert.deepEqual(history.select(today, 'speaking'), speaking);
});

test('new histories and settings without an origin safely start from the Today root', () => {
  const first = createIOSRouteHistory(root), second = createIOSRouteHistory(root);
  first.select(questionRoute('speaking'), 'settings');
  assert.equal(second.settingsOrigin(), undefined);
  assert.deepEqual(second.back(root('settings')), root('today'));
  assert.equal(second.select(root('words'), 'speaking').questionId, null);
});

test('back tickets reject malformed values while monotonic ordering remains the App consumer responsibility', () => {
  for (const value of [undefined, null, false, 4, '4', [], {}, { ticket: undefined }, { ticket: '4' }, { ticket: true }, { ticket: 0 }, { ticket: -1 }, { ticket: 1.5 }, { ticket: NaN }, { ticket: Infinity }, { ticket: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(nativeBackTicket(value), null);
  assert.equal(nativeBackTicket({ ticket: 1 }), 1);
  assert.equal(nativeBackTicket({ ticket: 42, unrelated: 'ignored' }), 42);
  assert.equal(nativeBackTicket({ ticket: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER);
  // A parser has no session state: the root event handler, rather than this
  // function, compares a valid ticket with its last accepted navigation ticket.
  assert.equal(nativeBackTicket({ ticket: 2 }), 2);
});
