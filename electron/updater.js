/**
 * Auto-update (Windows installed build only).
 *
 * macOS is intentionally left out: Squirrel.Mac refuses updates that are not signed
 * with a Developer ID, which this project does not have. The Windows portable build is left
 * out too: electron-updater would run the NSIS installer and add an installed copy instead of
 * replacing the portable exe. Both report state 'unsupported' and the UI falls back to a link to
 * the releases page; a packaged build still looks for a newer GitHub release (latestVersion) so
 * the UI can announce it.
 *
 * Flow: check -> download in background -> tell the renderer -> install when the user asks.
 */
const { app } = require('electron');
const { findNewerRelease, plainNotes } = require('./release_check');

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
  // electron-builder's portable launcher sets PORTABLE_EXECUTABLE_FILE
  return process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
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
    if (app.isPackaged) {
      setTimeout(checkLatestRelease, FIRST_CHECK_DELAY_MS);
      timer = setInterval(checkLatestRelease, CHECK_INTERVAL_MS);
    }
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
    setStatus({ state: 'downloading', version: info && info.version, percent: 0, error: null, releaseNotes: plainNotes(info && info.releaseNotes) });
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
    setStatus({ state: 'downloaded', version: info && info.version, percent: 100, error: null, releaseNotes: plainNotes(info && info.releaseNotes) || lastStatus.releaseNotes || '' });
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

/** Builds without auto-update: announce a newer GitHub release (the UI links to its download page). */
async function checkLatestRelease() {
  try {
    const found = await findNewerRelease(currentVersion());
    if (found) {
      log(`Newer release on GitHub: ${found.version}`);
      setStatus({ latestVersion: found.version, releaseNotes: found.notes, releasesUrl: found.url || RELEASES_URL });
    }
  } catch (e) {
    log(`Release check skipped: ${(e && e.message) || e}`); // offline or rate-limited: try again next interval
  }
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
  // Silent: the NSIS wizard (oneClick: false) would otherwise walk the user through every
  // install step again. A silent update reuses the previous install directory and relaunches.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { initUpdater, checkForUpdates, quitAndInstall, getStatus, RELEASES_URL };
