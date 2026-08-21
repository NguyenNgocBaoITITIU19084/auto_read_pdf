const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { startPythonBackend, stopPythonBackend, waitForBackend } = require('./py_manager');

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'Auto Read PDF Pro',
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Start Python backend
  startPythonBackend();

  // Wait for backend to be healthy
  const backendReady = await waitForBackend();
  if (!backendReady) {
    console.error('Failed to connect to Python backend server');
    if (!isDev) {
      const fs = require('fs');
      const logPath = path.join(app.getPath('userData'), 'backend.log');
      let logSnippet = '';
      try {
        if (fs.existsSync(logPath)) {
          const raw = fs.readFileSync(logPath, 'utf8');
          logSnippet = raw.slice(-1200).trim();
        }
      } catch (e) {}

      dialog.showErrorBox(
        'Backend Initialization Error',
        'Không thể khởi động dịch vụ xử lý dữ liệu (FastAPI Backend).\n\n' +
        (logSnippet ? 'Chi tiết lỗi:\n' + logSnippet + '\n\n' : '') +
        'File log đầy đủ tại:\n' + logPath
      );
    }
  }

  if (isDev) {
    const devUrl = 'http://localhost:5173';
    console.log(`[Electron] Loading dev server from: ${devUrl}`);
    mainWindow.loadURL(devUrl);
    // mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    console.log(`[Electron] Loading production build from: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonBackend();
});

app.on('will-quit', () => {
  stopPythonBackend();
});
