const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNotifier } = require('./notifier');

class FakeNotification extends EventEmitter {
  static supported = true;
  static shown = [];
  static isSupported() { return FakeNotification.supported; }
  constructor(opts) { super(); this.opts = opts; }
  show() { FakeNotification.shown.push(this); }
}

function setup(over = {}) {
  FakeNotification.supported = true;
  FakeNotification.shown = [];
  const calls = { window: 0, sent: [], requests: [] };
  const notifier = createNotifier({
    backendRequest: async (method, path) => { calls.requests.push(`${method} ${path}`); return over.response ?? { items: [], summary: null }; },
    Notification: FakeNotification,
    showMainWindow: () => { calls.window += 1; },
    sendToRenderer: (channel, payload) => calls.sent.push([channel, payload]),
    isAppFocused: () => !!over.focused,
    ...(over.deps || {}),
  });
  return { notifier, calls };
}

const one = { items: [{ id: 1 }], summary: { title: 'Cont EMCU1234567 đã OUTGATE', body: '26/09/2026 09:46', count: 1, nav_tab: 'container', nav_query: 'EMCU1234567' } };

test('claims from the backend and shows one popup for the batch', async () => {
  const { notifier, calls } = setup({ response: one });
  await notifier.poll();
  assert.deepEqual(calls.requests, ['POST /api/v1/notifications/claim-os']);
  assert.equal(FakeNotification.shown.length, 1);
  assert.deepEqual(FakeNotification.shown[0].opts, { title: 'Cont EMCU1234567 đã OUTGATE', body: '26/09/2026 09:46', silent: false });
  assert.deepEqual(calls.sent, [['notifications-changed', undefined]]);
});

test('nothing to show when the backend has nothing new', async () => {
  const { notifier, calls } = setup();
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 0);
  assert.deepEqual(calls.sent, []);
});

test('no popup while the user is looking at the app, but the bell is still refreshed', async () => {
  const { notifier, calls } = setup({ response: one, focused: true });
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 0);
  assert.deepEqual(calls.sent, [['notifications-changed', undefined]]);
});

test('no popup when the backend withholds the summary (popups switched off)', async () => {
  const { notifier } = setup({ response: { items: [{ id: 1 }], summary: null } });
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 0);
});

test('clicking a popup brings the window up and opens the matching tab', async () => {
  const { notifier, calls } = setup({ response: one });
  await notifier.poll();
  assert.equal(notifier.pending, 1);
  FakeNotification.shown[0].emit('click');
  assert.equal(calls.window, 1);
  assert.deepEqual(calls.sent.at(-1), ['notification-navigate', { tab: 'container', query: 'EMCU1234567' }]);
  assert.equal(notifier.pending, 0);
});

test('a popup that closes or fails is forgotten', async () => {
  const { notifier } = setup({ response: one });
  await notifier.poll();
  FakeNotification.shown[0].emit('close');
  assert.equal(notifier.pending, 0);
});

test('a failing backend call is swallowed and the next poll works', async () => {
  let fail = true;
  const logs = [];
  const { notifier } = setup({ deps: { backendRequest: async () => { if (fail) throw new Error('HTTP 404'); return one; }, log: (m) => logs.push(m) } });
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 0);
  assert.match(logs[0], /HTTP 404/);
  fail = false;
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 1);
});

test('overlapping polls do not double-claim', async () => {
  let inFlight = 0, max = 0;
  const { notifier } = setup({ deps: { backendRequest: async () => { inFlight += 1; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight -= 1; return { items: [], summary: null }; } } });
  await Promise.all([notifier.poll(), notifier.poll(), notifier.poll()]);
  assert.equal(max, 1);
});

test('unsupported platforms are skipped without throwing', async () => {
  const { notifier } = setup({ response: one });
  FakeNotification.supported = false;
  await notifier.poll();
  assert.equal(FakeNotification.shown.length, 0);
});

test('force shows the popup even while the app is focused (the "send a test" button)', async () => {
  const { notifier } = setup({ response: one, focused: true });
  await notifier.poll({ force: true });
  assert.equal(FakeNotification.shown.length, 1);
});
