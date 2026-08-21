const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { app } = require('electron');

let pyProcess = null;
const BACKEND_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

function getPythonPath() {
  // In development, check root .venv
  const venvPythonMac = path.join(__dirname, '..', '.venv', 'bin', 'python');
  const venvPythonWin = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');

  if (fs.existsSync(venvPythonMac)) {
    return venvPythonMac;
  }
  if (fs.existsSync(venvPythonWin)) {
    return venvPythonWin;
  }

  // Packaged mode check inside extraResources
  if (process.resourcesPath) {
    const packagedCandidates = [
      path.join(process.resourcesPath, 'backend_dist', 'backend_app'),
      path.join(process.resourcesPath, 'backend_dist', 'backend_app.exe'),
      path.join(process.resourcesPath, 'backend_dist', 'backend_app', 'backend_app'),
      path.join(process.resourcesPath, 'backend_dist', 'backend_app', 'backend_app.exe'),
    ];
    for (const cand of packagedCandidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
  }

  // Fallback to system python
  return process.platform === 'win32' ? 'python' : 'python3';
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(maxRetries = 40, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    const isHealthy = await checkHealth();
    if (isHealthy) {
      console.log(`[Python Manager] FastAPI Backend is healthy and ready on port ${BACKEND_PORT}!`);
      return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.error('[Python Manager] Timeout waiting for FastAPI backend to start.');
  return false;
}

async function startPythonBackend() {
  // First, check if backend is already running (e.g. started by npm run dev concurrently)
  const alreadyRunning = await checkHealth();
  if (alreadyRunning) {
    console.log('[Python Manager] Python backend is already running and healthy.');
    return null;
  }

  const pythonPath = getPythonPath();
  const rootDir = path.join(__dirname, '..');
  const isPackaged = app ? app.isPackaged : false;
  const userDataDir = app ? app.getPath('userData') : rootDir;
  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (e) {
      console.error('[Python Manager] Failed to create userData directory:', e);
    }
  }

  // Ensure fresh, writable user database path (no pre-packaged sample DB)
  const dbPath = process.env.DB_PATH || (isPackaged 
    ? path.join(userDataDir, 'booking_data.db') 
    : path.join(rootDir, 'backend', 'booking_data.db'));

  const logFilePath = path.join(userDataDir, 'backend.log');
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  console.log(`[Python Manager] Starting Python backend using: ${pythonPath}`);
  console.log(`[Python Manager] Target SQLite DB Path: ${dbPath}`);
  console.log(`[Python Manager] Backend Log Path: ${logFilePath}`);

  const spawnOptions = {
    cwd: pythonPath.includes('backend_dist') ? path.dirname(pythonPath) : rootDir,
    windowsHide: true,
    env: { 
      ...process.env, 
      PORT: String(BACKEND_PORT), 
      PYTHONPATH: rootDir,
      DB_PATH: dbPath,
    },
  };

  // If using packaged binary directly
  if (pythonPath.includes('backend_dist')) {
    pyProcess = spawn(pythonPath, [], spawnOptions);
  } else {
    // Run module backend.app.main
    pyProcess = spawn(pythonPath, ['-m', 'backend.app.main'], spawnOptions);
  }

  pyProcess.on('error', (err) => {
    console.error(`[Python Backend Spawn Error]: ${err.message}`);
    logStream.write(`\n[Spawn Error ${new Date().toISOString()}]: ${err.stack || err.message}\n`);
  });

  pyProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[Python Backend]: ${text.trim()}`);
    logStream.write(`[STDOUT ${new Date().toISOString()}]: ${text}`);
  });

  pyProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`[Python Backend Error]: ${text.trim()}`);
    logStream.write(`[STDERR ${new Date().toISOString()}]: ${text}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`[Python Backend] Exited with code ${code}`);
    logStream.write(`[EXIT ${new Date().toISOString()}]: Exited with code ${code}\n`);
    pyProcess = null;
  });

  return pyProcess;
}

function stopPythonBackend() {
  if (pyProcess) {
    console.log('[Python Manager] Terminating Python backend process...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pyProcess.pid), '/f', '/t'], { windowsHide: true });
      } else {
        pyProcess.kill('SIGTERM');
      }
    } catch (e) {
      console.error('[Python Manager] Error stopping Python process:', e);
    }
    pyProcess = null;
  }
}

module.exports = {
  startPythonBackend,
  stopPythonBackend,
  waitForBackend,
  BACKEND_PORT,
};
