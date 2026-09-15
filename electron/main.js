const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  ipcMain,
  nativeTheme,
  powerMonitor,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { backend, backendRequest } = require('./py_manager');
const { createTrayIcon, createAppIcon } = require('./tray_icon');

const APP_NAME = 'Auto Read PDF Pro';
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const DEV_URL = 'http://localhost:5173';
const DIST_DIR = path.join(__dirname, '..', 'frontend', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const SPLASH_HTML = path.join(__dirname, 'splash.html');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backendStopped = false;
let autoSyncActive = false;
let autoSyncSetByRenderer = false;
let trayHintShown = false;
let windowReadyToShow = false;
let page = 'none'; // 'splash' | 'ui'
let splashReady = false;
let lastStatus = { state: 'starting', message: 'Đang khởi động...' };

// ---------------------------------------------------------------------------
// Single instance: a second launch focuses the existing window (no 2nd backend)
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(onReady);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isHttpUrl(url) {
  try {
    const p = new URL(url);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isAppUrl(url) {
  try {
    const p = new URL(url);
    if (isDev && p.origin === new URL(DEV_URL).origin) return true;
    if (p.protocol === 'file:') {
      const fp = path.normalize(fileURLToPath(p));
      return fp === SPLASH_HTML || fp.startsWith(DIST_DIR + path.sep);
    }
  } catch (e) {}
  return false;
}

function isFromMainWindow(event) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  windowReadyToShow = false;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: APP_NAME,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#020617' : '#f8fafc',
    icon: process.platform === 'darwin' ? undefined : createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const win = mainWindow;
  const wc = win.webContents;

  win.once('ready-to-show', () => {
    windowReadyToShow = true;
    win.show();
  });

  win.on('close', (event) => {
    if (isQuitting || !autoSyncActive) return;
    event.preventDefault();
    ensureTray();
    win.hide();
    if (process.platform === 'win32' && tray && !trayHintShown) {
      trayHintShown = true;
      try {
        tray.displayBalloon({
          title: APP_NAME,
          content: 'Ứng dụng vẫn chạy nền để tự động đồng bộ. Bấm biểu tượng ở khay hệ thống để mở lại.',
        });
      } catch (e) {}
    }
  });

  // Windows: system shutdown / logoff must not be blocked by hide-to-tray
  win.on('session-end', () => {
    isQuitting = true;
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    page = 'none';
    splashReady = false;
  });

  // Windows focus-loss workaround after native dialogs (alert/confirm/file pickers)
  win.on('focus', () => {
    if (!wc.isDestroyed()) wc.focus();
  });

  // Links: external http(s) → system browser; never open new Electron windows
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
  });

  wc.on('context-menu', (_event, params) => buildContextMenu(params));

  wc.on('did-finish-load', () => {
    if (page === 'splash') {
      splashReady = true;
      renderSplash();
    }
  });

  if (backend.state === 'ready') {
    loadUI();
  } else {
    showSplash();
    if (backend.state === 'stopped' || backend.state === 'idle') backend.start();
  }
  return win;
}

function showMainWindow() {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (!windowReadyToShow) return; // first paint pending; ready-to-show will show it
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function showSplash() {
  if (!mainWindow) return;
  page = 'splash';
  splashReady = false;
  mainWindow.loadFile(SPLASH_HTML).catch(() => {});
}

function renderSplash() {
  if (!mainWindow || mainWindow.isDestroyed() || page !== 'splash' || !splashReady) return;
  const s = lastStatus;
  const js =
    s.state === 'failed'
      ? `window.showError && window.showError(${JSON.stringify(s.message || '')}, ${JSON.stringify(backend.logPath)})`
      : `window.setStatus && window.setStatus(${JSON.stringify(s.message || 'Đang khởi động...')})`;
  mainWindow.webContents.executeJavaScript(js).catch(() => {});
}

function loadUI() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  page = 'ui';
  splashReady = false;
  if (isDev) {
    console.log(`[Electron] Loading dev server from: ${DEV_URL}`);
    mainWindow.loadURL(DEV_URL).catch(() => {});
  } else {
    mainWindow.loadFile(INDEX_HTML).catch(() => {});
  }
}

function buildContextMenu(params) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { isEditable, selectionText, editFlags, linkURL } = params;
  const template = [];

  if (isEditable) {
    template.push(
      { role: 'cut', label: 'Cắt', enabled: editFlags.canCut },
      { role: 'copy', label: 'Sao chép', enabled: editFlags.canCopy },
      { role: 'paste', label: 'Dán', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Chọn tất cả', enabled: editFlags.canSelectAll }
    );
  } else {
    if (selectionText && selectionText.trim()) {
      template.push({ role: 'copy', label: 'Sao chép' });
    }
    // Allow pasting an image/file anywhere (app-level paste listener handles it)
    const formats = clipboard.availableFormats();
    if (formats.some((f) => f.startsWith('image/') || f === 'text/uri-list')) {
      template.push({ label: 'Dán', click: () => mainWindow && mainWindow.webContents.paste() });
    }
  }

  if (linkURL && isHttpUrl(linkURL) && !isAppUrl(linkURL)) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Mở liên kết trong trình duyệt', click: () => shell.openExternal(linkURL).catch(() => {}) },
      { label: 'Sao chép liên kết', click: () => clipboard.writeText(linkURL) }
    );
  }

  if (isDev) {
    if (template.length) template.push({ type: 'separator' });
    template.push({
      label: 'Inspect Element',
      click: () => mainWindow && mainWindow.webContents.inspectElement(params.x, params.y),
    });
  }

  if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

// ---------------------------------------------------------------------------
// Tray / background auto-sync
// ---------------------------------------------------------------------------
function ensureTray() {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở app', click: () => showMainWindow() },
      { label: 'Đồng bộ ngay', click: () => runSyncNow(true) },
      { type: 'separator' },
      {
        label: 'Thoát',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  if (process.platform !== 'darwin') {
    tray.on('click', () => showMainWindow());
  }
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

function setAutoSyncActive(active) {
  autoSyncActive = !!active;
  if (autoSyncActive) {
    ensureTray();
  } else {
    // Never leave a hidden window without a way back
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    destroyTray();
  }
}

async function runSyncNow(fromTray = false) {
  try {
    const res = await backendRequest('POST', '/api/v1/scheduler/run-now');
    backend.info(`run-now requested (${fromTray ? 'tray' : 'resume'}): ${res && res.status}`);
    if (fromTray && process.platform === 'win32' && tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: APP_NAME,
        content: res && res.status === 'already_running' ? 'Đang đồng bộ, vui lòng đợi.' : 'Đã bắt đầu đồng bộ.',
      });
    }
  } catch (e) {
    backend.info(`run-now failed: ${e.message}`);
  }
}

async function initAutoSyncFlag() {
  try {
    const status = await backendRequest('GET', '/api/v1/scheduler/status');
    if (!autoSyncSetByRenderer && status && typeof status.enabled === 'boolean') {
      setAutoSyncActive(status.enabled);
    }
  } catch (e) {
    backend.info(`Could not read scheduler status: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('open-external', async (event, url) => {
    if (!isFromMainWindow(event)) throw new Error('Forbidden');
    if (typeof url !== 'string' || !isHttpUrl(url)) throw new Error('Only http/https URLs are allowed');
    await shell.openExternal(url);
  });

  ipcMain.handle('read-clipboard-image', (event) => {
    if (!isFromMainWindow(event)) return null;
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toDataURL();
  });

  ipcMain.on('set-auto-sync-active', (event, active) => {
    if (!isFromMainWindow(event)) return;
    autoSyncSetByRenderer = true;
    setAutoSyncActive(active);
  });

  ipcMain.on('backend-retry', (event) => {
    if (!isFromMainWindow(event)) return;
    backend.info('Manual retry requested from error screen');
    backend.retry();
  });

  ipcMain.on('backend-show-log', (event) => {
    if (!isFromMainWindow(event)) return;
    const logPath = backend.logPath;
    if (fs.existsSync(logPath)) shell.showItemInFolder(logPath);
    else shell.openPath(path.dirname(logPath));
  });

  ipcMain.on('open-log-folder', (event) => {
    if (!isFromMainWindow(event)) return;
    const dir = backend.logDir;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
function onReady() {
  registerIpc();

  backend.on('status', (status) => {
    lastStatus = status;
    sendToRenderer('backend-status', status);

    if (status.state === 'ready') {
      if (page !== 'ui') loadUI();
      initAutoSyncFlag();
      if (tray && !tray.isDestroyed()) tray.setToolTip(APP_NAME);
    } else if (status.state === 'failed') {
      if (tray && !tray.isDestroyed()) tray.setToolTip(`${APP_NAME} — lỗi dịch vụ nền`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (page !== 'splash') showSplash();
        else renderSplash();
        if (windowReadyToShow && !mainWindow.isVisible()) mainWindow.show();
      }
    } else {
      renderSplash();
    }
  });

  createWindow(); // shows the splash immediately and starts the backend

  app.on('activate', () => showMainWindow());

  // Catch up missed schedules after sleep
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      if (autoSyncActive && backend.state === 'ready') runSyncNow(false);
    }, 10000);
  });
  powerMonitor.on('shutdown', () => {
    isQuitting = true;
  });
}

app.on('window-all-closed', () => {
  // macOS convention: app (and backend) stay alive until Cmd+Q
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', (event) => {
  if (backendStopped) return;
  event.preventDefault();
  destroyTray();
  const timeout = new Promise((r) => setTimeout(r, 5000));
  Promise.race([backend.stop(), timeout])
    .catch(() => {})
    .finally(() => {
      backendStopped = true;
      backend.stopSync();
      app.exit(0);
    });
});

process.on('exit', () => backend.stopSync());
