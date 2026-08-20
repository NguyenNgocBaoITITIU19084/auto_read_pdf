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
    http.get(HEALTH_URL, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    }).on('error', () => {
      resolve(false);
    });
  });
}

async function waitForBackend(maxRetries = 40, delayMs = 500) {
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
  
  // Ensure fresh, writable user database path (no pre-packaged sample DB)
  const dbPath = process.env.DB_PATH || (isPackaged 
    ? path.join(userDataDir, 'booking_data.db') 
    : path.join(rootDir, 'backend', 'booking_data.db'));

  console.log(`[Python Manager] Starting Python backend using: ${pythonPath}`);
  console.log(`[Python Manager] Target SQLite DB Path: ${dbPath}`);

  // If using packaged binary directly
  if (pythonPath.includes('backend_dist')) {
    pyProcess = spawn(pythonPath, [], {
      cwd: path.dirname(pythonPath),
      env: { 
        ...process.env, 
        PORT: String(BACKEND_PORT),
        DB_PATH: dbPath,
      },
    });
  } else {
    // Run module backend.app.main
    pyProcess = spawn(pythonPath, ['-m', 'backend.app.main'], {
      cwd: rootDir,
      env: { 
        ...process.env, 
        PORT: String(BACKEND_PORT), 
        PYTHONPATH: rootDir,
        DB_PATH: dbPath,
      },
    });
  }

  pyProcess.stdout.on('data', (data) => {
    console.log(`[Python Backend]: ${data.toString().trim()}`);
  });

  pyProcess.stderr.on('data', (data) => {
    console.error(`[Python Backend Error]: ${data.toString().trim()}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`[Python Backend] Exited with code ${code}`);
    pyProcess = null;
  });

  return pyProcess;
}

function stopPythonBackend() {
  if (pyProcess) {
    console.log('[Python Manager] Terminating Python backend process...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pyProcess.pid, '/f', '/t']);
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
