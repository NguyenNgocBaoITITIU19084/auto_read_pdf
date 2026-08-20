const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

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

  // Packaged mode check
  const packagedPyMac = path.join(process.resourcesPath, 'backend_dist', 'backend_app');
  const packagedPyWin = path.join(process.resourcesPath, 'backend_dist', 'backend_app.exe');

  if (fs.existsSync(packagedPyMac)) {
    return packagedPyMac;
  }
  if (fs.existsSync(packagedPyWin)) {
    return packagedPyWin;
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

  console.log(`[Python Manager] Starting Python backend using: ${pythonPath}`);

  // If using packaged binary directly
  if (pythonPath.includes('backend_dist')) {
    pyProcess = spawn(pythonPath, [], {
      cwd: rootDir,
      env: { ...process.env, PORT: String(BACKEND_PORT) },
    });
  } else {
    // Run module backend.app.main
    pyProcess = spawn(pythonPath, ['-m', 'backend.app.main'], {
      cwd: rootDir,
      env: { ...process.env, PORT: String(BACKEND_PORT), PYTHONPATH: rootDir },
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
