/**
 * Windows only shows a toast for an app whose AppUserModelID is carried by a Start Menu shortcut.
 * The installer creates that shortcut; the portable build has none, so its toasts vanish. Under `npm run dev` toasts
 * also need electron.exe pinned to Start by hand.
 *
 * Dependencies are injected so the logic can be tested without Electron (see win_toast.test.js).
 */
const path = require('node:path');

const APP_ID = 'com.autoreadpdf.pro';
/** Not the installer's 'Auto Read PDF Pro.lnk': overwriting that would repoint an installed app at the portable .exe.
 *  Windows only needs some Start Menu shortcut carrying the id. */
const SHORTCUT_NAME = 'Auto Read PDF Pro (Portable).lnk';

/**
 * Sets the AppUserModelID and, for the portable build, (re)creates the Start Menu shortcut that lets toasts show.
 * `portableExe` is electron-builder's PORTABLE_EXECUTABLE_FILE: the .exe the user launched (process.execPath is a
 * temporary copy). Returns what it did, for the log.
 */
function setupWindowsToasts({ platform, isDev, execPath, portableExe, appDataDir, setAppUserModelId, writeShortcutLink }) {
  if (platform !== 'win32') return 'skipped';
  if (isDev) {
    // The id Electron's docs pair with pinning node_modules\electron\dist\electron.exe to Start; no toasts without that pin
    setAppUserModelId(execPath);
    return 'dev';
  }
  setAppUserModelId(APP_ID);
  if (!portableExe) return 'installed'; // the installer's shortcut carries APP_ID
  const link = path.win32.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_NAME);
  try {
    // 'create' overwrites, so a portable .exe that was moved gets its shortcut pointed at the new place
    const ok = writeShortcutLink(link, 'create', { target: portableExe, appUserModelId: APP_ID, description: 'Auto Read PDF Pro' });
    return ok ? 'portable' : 'portable-no-shortcut';
  } catch {
    return 'portable-no-shortcut';
  }
}

module.exports = { setupWindowsToasts, APP_ID, SHORTCUT_NAME };
