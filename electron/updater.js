/**
 * Auto-update (Windows only).
 *
 * macOS is intentionally left out: Squirrel.Mac refuses updates that are not signed
 * with a Developer ID, which this project does not have. On mac the module reports
 * state 'unsupported' and the UI falls back to a link to the releases page.
 *
 * Flow: check -> download in background -> tell the renderer -> install when the user asks.
 */
const { app } = require('electron');

const RELEASES_URL = 'https://github.com/NguyenNgocBaoITITIU19084/auto_read_pdf/releases/latest';
const FIRST_CHECK_DELAY_MS = 20_000; // let the backend finish booting first
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let autoUpdater = null;
let onStatus = () => {};
let lastStatus = { state: 'idle', currentVersion: currentVersion() };
let timer = null;
let checking = false;

function currentVersion() {
  try {
    return app.getVersion();
  } catch (e) {
    return '';
  }
}

function supported() {
  return process.platform === 'win32' && app.isPackaged;
}

function setStatus(patch) {
  lastStatus = { ...lastStatus, ...patch, currentVersion: currentVersion() };
  onStatus(lastStatus);
}

function getStatus() {
  return lastStatus;
}

function log(msg) {
  try {
    console.log(`[Updater] ${msg}`);
  } catch (e) {}
}

function initUpdater({ onStatus: statusCallback, log: logger } = {}) {
  if (typeof statusCallback === 'function') onStatus = statusCallback;
  if (typeof logger === 'function') log = logger;

  if (!supported()) {
    setStatus({ state: 'unsupported', releasesUrl: RELEASES_URL });
    return;
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    // On Windows this means the dependency was not packaged — a real bug. Surface it as an
    // error instead of 'unsupported', which would look like the intended macOS behaviour.
    log(`electron-updater not available: ${e.message}`);
    setStatus({ state: 'error', error: `Không tải được bộ cập nhật: ${e.message}`, releasesUrl: RELEASES_URL });
    return;
  }

  autoUpdater.autoDownload = true;
  // Install only through quitAndInstall(): the app's own will-quit handler ends in
  // app.exit(0) after stopping the backend, which skips electron-updater's 'quit' hook,
  // so install-on-quit would silently never run.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info && info.version}`);
    setStatus({ state: 'downloading', version: info && info.version, percent: 0, error: null });
  });
  autoUpdater.on('update-not-available', () => {
    checking = false;
    setStatus({ state: 'up-to-date', version: null, error: null });
  });
  autoUpdater.on('download-progress', (p) => {
    setStatus({ state: 'downloading', percent: Math.round((p && p.percent) || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    checking = false;
    log(`Update downloaded: ${info && info.version}`);
    setStatus({ state: 'downloaded', version: info && info.version, percent: 100, error: null });
  });
  autoUpdater.on('error', (err) => {
    checking = false;
    const message = (err && err.message) || String(err);
    log(`Update error: ${message}`);
    setStatus({ state: 'error', error: message });
  });

  setStatus({ state: 'idle', releasesUrl: RELEASES_URL });

  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
}

/** Returns the status after the check was started (not after it finished). */
async function checkForUpdates(manual = true) {
  if (!autoUpdater) {
    if (manual) setStatus({ state: 'unsupported', releasesUrl: RELEASES_URL });
    return getStatus();
  }
  // A download already finished / is running: nothing to re-check.
  if (lastStatus.state === 'downloaded' || lastStatus.state === 'downloading') return getStatus();
  if (checking) return getStatus();
  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    checking = false;
    setStatus({ state: 'error', error: (e && e.message) || String(e) });
  }
  return getStatus();
}

/**
 * Install the downloaded update. `beforeInstall` must fully stop the packaged Python
 * backend first — on Windows the NSIS installer cannot replace resources/backend_dist
 * while that child process still holds the files open.
 */
async function quitAndInstall(beforeInstall) {
  if (!autoUpdater || lastStatus.state !== 'downloaded') return false;
  if (timer) clearInterval(timer);
  try {
    if (typeof beforeInstall === 'function') await beforeInstall();
  } catch (e) {
    log(`beforeInstall failed: ${(e && e.message) || e}`);
  }
  log('Quitting to install update');
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = { initUpdater, checkForUpdates, quitAndInstall, getStatus, RELEASES_URL };
