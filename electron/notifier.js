/**
 * Desktop popups for vessel / container changes found by the background auto-sync.
 *
 * Owned by the main process on purpose: while the window is hidden in the tray the UI's timers are throttled,
 * yet that is exactly when a popup matters. Every POLL_MS it "claims" the notifications the backend has not
 * handed out yet (each is returned once) and shows ONE grouped popup per batch. The backend already applies the
 * user's "desktop popups on/off" setting; here we only decide whether the user is looking at the app.
 *
 * Dependencies are injected so the logic can be tested without Electron (see notifier.test.js).
 */
const POLL_MS = 20_000;

function createNotifier({ backendRequest, Notification, showMainWindow, sendToRenderer, isAppFocused, log = () => {}, pollMs = POLL_MS }) {
  let timer = null;
  let busy = false;
  // Keep a reference to every visible popup: an unreferenced Notification can be garbage-collected and never fire 'click'
  const live = new Set();

  function show(summary) {
    if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) return false;
    const popup = new Notification({ title: summary.title, body: summary.body, silent: false, sound: 'Submarine' });
    live.add(popup);
    const done = () => live.delete(popup);
    popup.on('click', () => {
      done();
      showMainWindow();
      sendToRenderer('notification-navigate', { tab: summary.nav_tab || null, query: summary.nav_query || null, notificationId: summary.notification_id || null });
    });
    popup.on('close', done);
    popup.on('failed', done);
    popup.show();
    return true;
  }

  /** `force`: show the popup even while the app is focused (the user pressed "send a test"). */
  async function poll({ force = false } = {}) {
    if (busy) return;
    busy = true;
    try {
      const res = await backendRequest('POST', '/api/v1/notifications/claim-os');
      const items = (res && res.items) || [];
      if (items.length === 0) return;
      sendToRenderer('notifications-changed'); // refresh the bell / badge
      if (!res.summary || (isAppFocused() && !force)) return; // the user is looking at the app: the bell and toast are enough
      show(res.summary);
    } catch (e) {
      // backend busy, restarting, or an older backend without this endpoint: try again next time
      log(`notification poll skipped: ${e && e.message}`);
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(poll, pollMs);
      setTimeout(poll, 3000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
    show,
    /** number of popups still on screen (for tests) */
    get pending() {
      return live.size;
    },
  };
}

module.exports = { createNotifier, POLL_MS };
