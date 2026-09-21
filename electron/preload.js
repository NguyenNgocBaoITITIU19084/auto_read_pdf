const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,

  /** Open an http(s) URL in the system browser. Other schemes are rejected. */
  openExternal: (url) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return Promise.reject(new Error('Only http/https URLs are allowed'));
      }
    } catch (e) {
      return Promise.reject(new Error('Invalid URL'));
    }
    return ipcRenderer.invoke('open-external', String(url)).then(() => undefined);
  },

  /** PNG data URL of the image currently on the clipboard, or null. */
  readClipboardImage: () => ipcRenderer.invoke('read-clipboard-image'),

  /** Tell main whether auto-sync is on (closing the window then hides to tray). */
  setAutoSyncActive: (active) => {
    ipcRenderer.send('set-auto-sync-active', !!active);
  },

  // --- Additive extras (not in the contract; optional for the renderer) ---
  /** Subscribe to backend lifecycle events: {state, message}. Returns an unsubscribe fn. */
  onBackendStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('backend-status', listener);
    return () => ipcRenderer.removeListener('backend-status', listener);
  },
  /** Used by the splash/error screen. */
  retryBackend: () => ipcRenderer.send('backend-retry'),
  showBackendLog: () => ipcRenderer.send('backend-show-log'),
  /** Open the folder containing app.log / errors.log. */
  openLogFolder: () => ipcRenderer.send('open-log-folder'),

  // --- Auto update (Windows only; other platforms report state 'unsupported') ---
  /** Subscribe to update events: {state, version, percent, error, currentVersion, releasesUrl}. */
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  /** Current update status without waiting for an event. */
  getUpdateStatus: () => ipcRenderer.invoke('update-status'),
  /** Check now; the download then runs in the background. Resolves with the status. */
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  /** Quit and install a downloaded update. Resolves false when nothing is ready. */
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
