const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');
const { app } = require('electron');

const BACKEND_PORT = 8000;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const HEALTH_URL = `${BACKEND_ORIGIN}/health`;

const LOG_MAX_BYTES = 5 * 1024 * 1024; // rotate backend.log at 5MB, keep 1 old file
const HEALTH_POLL_MS = 200;
const STARTUP_TIMEOUT_MS = 60000;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESTARTS = 3;

const isPackaged = () => (app ? app.isPackaged : false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Log file with size-based rotation (backend.log -> backend.log.1)
// ---------------------------------------------------------------------------
class RotatingLog {
  constructor(filePath, maxBytes = LOG_MAX_BYTES) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.fd = null;
    this.size = 0;
    this._open();
    if (this.size >= this.maxBytes) this._rotate();
  }

  _open() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.fd = fs.openSync(this.filePath, 'a');
      this.size = fs.fstatSync(this.fd).size;
    } catch (e) {
      console.error('[Python Manager] Cannot open log file:', e.message);
      this.fd = null;
      this.size = 0;
    }
  }

  _rotate() {
    try {
      if (this.fd !== null) fs.closeSync(this.fd);
    } catch (e) {}
    this.fd = null;
    const old = `${this.filePath}.1`;
    try {
      fs.rmSync(old, { force: true });
    } catch (e) {}
    try {
      fs.renameSync(this.filePath, old);
    } catch (e) {}
    this._open();
  }

  write(text) {
    if (this.fd === null) return;
    const buf = Buffer.from(text, 'utf8');
    if (this.size + buf.length > this.maxBytes) this._rotate();
    if (this.fd === null) return;
    try {
      fs.writeSync(this.fd, buf);
      this.size += buf.length;
    } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getPythonPath() {
  const packagedCandidates = process.resourcesPath
    ? [
        path.join(process.resourcesPath, 'backend_dist', 'backend_app.exe'),
        path.join(process.resourcesPath, 'backend_dist', 'backend_app'),
        path.join(process.resourcesPath, 'backend_dist', 'backend_app', 'backend_app.exe'),
        path.join(process.resourcesPath, 'backend_dist', 'backend_app', 'backend_app'),
      ]
    : [];
  const venvCandidates = [
    path.join(__dirname, '..', '.venv', 'bin', 'python'),
    path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe'),
  ];
  const ordered = isPackaged() ? [...packagedCandidates, ...venvCandidates] : [...venvCandidates, ...packagedCandidates];
  for (const cand of ordered) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    } catch (e) {}
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** GET /health → parsed JSON (or {} for non-JSON 200) when healthy, else null. */
async function checkHealth(timeoutMs = 800) {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) return null;
    try {
      return await res.json();
    } catch (e) {
      return {};
    }
  } catch (e) {
    return null;
  }
}

function isPortInUse(port = BACKEND_PORT, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve(err && !stdout ? '' : String(stdout || ''));
    });
  });
}

/** Find the process LISTENING on the port → {pid, name} or null. */
async function findPortListener(port = BACKEND_PORT) {
  try {
    if (process.platform === 'win32') {
      const out = await run('netstat', ['-ano', '-p', 'TCP']);
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
        const [, local, foreign, state, pidStr] = parts;
        const listening = /LISTEN/i.test(state) || /:0$/.test(foreign);
        if (!listening || !local.endsWith(`:${port}`)) continue;
        const pid = parseInt(pidStr, 10);
        if (!pid) continue;
        const csv = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
        const m = csv.match(/^"([^"]+)"/m);
        return { pid, name: m ? m[1] : '' };
      }
      return null;
    }
    const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    const pid = parseInt(out.split(/\s+/).filter(Boolean)[0], 10);
    if (!pid) return null;
    const name = (await run('ps', ['-p', String(pid), '-o', 'comm='])).trim();
    return { pid, name };
  } catch (e) {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Kill a process (and its children on Windows). Resolves when gone or after timeout. */
async function killPid(pid, timeoutMs = 3000) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await sleep(100);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Backend manager
// ---------------------------------------------------------------------------
/**
 * Events: 'status' → { state, message, attempt? }
 *   state: 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'
 */
class BackendManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.owned = false; // true when we spawned the process currently serving port 8000
    this.stopping = false;
    this.restartTimes = [];
    this.restartTimer = null;
    this.state = 'idle';
    this.message = '';
    this._log = null;
  }

  get logPath() {
    const dir = app ? app.getPath('userData') : path.join(__dirname, '..');
    return path.join(dir, 'backend.log');
  }

  /** Folder holding app.log / errors.log (written by the Python backend). */
  get logDir() {
    const dir = app ? app.getPath('userData') : path.join(__dirname, '..');
    return path.join(dir, 'logs');
  }

  get log() {
    if (!this._log) this._log = new RotatingLog(this.logPath);
    return this._log;
  }

  info(msg) {
    console.log(`[Python Manager] ${msg}`);
    this.log.write(`[ELECTRON ${new Date().toISOString()}]: ${msg}\n`);
  }

  _setState(state, message = '', extra = {}) {
    this.state = state;
    this.message = message;
    this.emit('status', { state, message, ...extra });
  }

  get expectedVersion() {
    return app ? app.getVersion() : '';
  }

  /** Full startup: deal with an existing backend on the port, spawn, wait for /health. */
  async start() {
    this.stopping = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this._setState('starting', 'Đang kiểm tra dịch vụ nền...');

    const decision = await this._handleExistingBackend();
    if (decision === 'reuse') {
      this._setState('ready', 'Dịch vụ nền đã sẵn sàng');
      return true;
    }
    if (decision === 'blocked') {
      return false; // state already set to failed
    }

    this._setState('starting', 'Đang khởi động dịch vụ nền...');
    this._spawn();
    const ok = await this._waitHealthy(STARTUP_TIMEOUT_MS);
    if (ok) {
      this.info(`FastAPI backend is healthy on port ${BACKEND_PORT}`);
      this._setState('ready', 'Dịch vụ nền đã sẵn sàng');
      return true;
    }
    // A crash during startup hands over to the auto-restart flow; don't mark it failed underneath it
    if (this.state !== 'failed' && this.state !== 'restarting' && !this.restartTimer) {
      this.info('Timeout waiting for FastAPI backend to start');
      this._setState('failed', 'Hết thời gian chờ dịch vụ nền khởi động (60 giây).');
    }
    return false;
  }

  /** Manual retry from the error screen: reset crash counter and start from scratch. */
  async retry() {
    this.restartTimes = [];
    await this.stop();
    return this.start();
  }

  async _handleExistingBackend() {
    const health = await checkHealth();
    const inUse = health ? true : await isPortInUse();
    if (!inUse) return 'free';

    const expected = this.expectedVersion;
    const listener = await findPortListener();
    const listenerDesc = listener ? `${listener.name || 'unknown'} (PID ${listener.pid})` : 'unknown process';
    const looksOurs = listener && /backend_app/i.test(path.basename(listener.name || ''));

    if (health) {
      const version = health.version || '?';
      if (!isPackaged()) {
        // Dev: backend is usually started by `npm run dev` (concurrently -k) — never kill it.
        if (version !== expected) {
          this.info(`WARNING: backend on port ${BACKEND_PORT} reports version ${version}, app is ${expected}. Reusing (dev mode).`);
        } else {
          this.info(`Reusing running backend on port ${BACKEND_PORT} (version ${version}).`);
        }
        return 'reuse';
      }
      if (looksOurs) {
        // Packaged: a healthy backend_app we did not spawn is a leftover from a crash. Its stdout pipe
        // is gone (no logs) and nobody would kill it on quit → replace it with a fresh child.
        this.info(`Found leftover backend ${listenerDesc} version ${version} (app ${expected}); restarting it.`);
        if (await this._killAndWaitPortFree(listener.pid)) return 'free';
        this.info('WARNING: could not stop leftover backend.');
      }
      if (version !== expected) {
        this.info(`WARNING: backend on port ${BACKEND_PORT} is version ${version} but app is ${expected} (${listenerDesc}); reusing it.`);
      } else {
        this.info(`Reusing running backend ${listenerDesc} version ${version}.`);
      }
      return 'reuse';
    }

    // Port busy but /health does not answer → hung old backend or foreign app.
    // Only kill processes that are clearly our packaged backend — in dev a busy `npm run dev` backend or an
    // unrelated Python server may hold the port, so report it instead of killing it.
    if (looksOurs) {
      this.info(`Port ${BACKEND_PORT} held by unresponsive backend ${listenerDesc}; killing it.`);
      if (await this._killAndWaitPortFree(listener.pid)) return 'free';
    }
    const msg = `Cổng ${BACKEND_PORT} đang bị tiến trình khác chiếm: ${listenerDesc}. Hãy tắt tiến trình đó rồi bấm "Thử lại".`;
    this.info(`ERROR: ${msg}`);
    this._setState('failed', msg);
    return 'blocked';
  }

  async _killAndWaitPortFree(pid) {
    await killPid(pid);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!(await isPortInUse())) return true;
      await sleep(200);
    }
    return false;
  }

  _spawn() {
    const pythonPath = getPythonPath();
    const rootDir = path.join(__dirname, '..');
    const userDataDir = app ? app.getPath('userData') : rootDir;
    const packagedBinary = pythonPath.includes('backend_dist');

    const dbPath =
      process.env.DB_PATH ||
      (isPackaged() ? path.join(userDataDir, 'booking_data.db') : path.join(rootDir, 'backend', 'booking_data.db'));

    this.info(`Starting backend: ${pythonPath}`);
    this.info(`SQLite DB: ${dbPath}`);

    const proc = spawn(pythonPath, packagedBinary ? [] : ['-m', 'backend.app.main'], {
      cwd: packagedBinary ? path.dirname(pythonPath) : rootDir,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        PYTHONPATH: rootDir,
        DB_PATH: dbPath,
        LOG_DIR: this.logDir,
        ELECTRON_BACKEND_LOG: this.logPath,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8', // avoid UnicodeEncodeError on Windows cp1252 pipes (Vietnamese log lines)
      },
    });
    this.proc = proc;
    this.owned = true;

    const verbose = !isPackaged();
    const pipe = (stream, tag) => {
      if (!stream) return;
      stream.on('data', (data) => {
        const text = data.toString();
        if (verbose) console.log(`[Python ${tag}]: ${text.trimEnd()}`);
        this.log.write(`[${tag} ${new Date().toISOString()}]: ${text.endsWith('\n') ? text : text + '\n'}`);
      });
    };
    pipe(proc.stdout, 'STDOUT');
    pipe(proc.stderr, 'STDERR');

    let exited = false;
    const onExit = (code, signal, err) => {
      if (exited) return;
      exited = true;
      if (err) this.info(`Spawn error: ${err.stack || err.message}`);
      this.info(`Backend exited (code=${code}, signal=${signal || ''})`);
      if (this.proc === proc) {
        this.proc = null;
        this.owned = false;
      }
      if (!this.stopping) this._scheduleRestart();
    };
    proc.once('error', (err) => onExit(null, null, err));
    proc.once('exit', (code, signal) => onExit(code, signal));
    return proc;
  }

  _scheduleRestart() {
    if (this.restartTimer) return;
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS) {
      const msg = `Dịch vụ nền bị dừng đột ngột ${MAX_RESTARTS} lần trong 5 phút và không thể tự khởi động lại.`;
      this.info(`ERROR: ${msg}`);
      this._setState('failed', msg);
      return;
    }
    this.restartTimes.push(now);
    const attempt = this.restartTimes.length;
    const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
    this.info(`Auto-restarting backend in ${delay}ms (attempt ${attempt}/${MAX_RESTARTS})`);
    this._setState('restarting', `Dịch vụ nền bị dừng, đang khởi động lại (lần ${attempt})...`, { attempt });
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.stopping) return;
      const proc = this._spawn();
      const ok = await this._waitHealthy(STARTUP_TIMEOUT_MS / 2);
      if (this.stopping || this.proc !== proc) return;
      if (ok) {
        this.info('Backend restarted and healthy');
        this._setState('ready', 'Dịch vụ nền đã khởi động lại');
      } else if (this.state !== 'failed') {
        this.info('Restarted backend did not become healthy; killing it');
        this.stopping = true;
        await this._killOwned();
        this.stopping = false;
        this._scheduleRestart();
      }
    }, delay);
  }

  async _waitHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping || this.state === 'failed') return false;
      if (await checkHealth(Math.min(800, Math.max(100, deadline - Date.now())))) return true;
      await sleep(HEALTH_POLL_MS);
    }
    return false;
  }

  async _killOwned() {
    const proc = this.proc;
    if (!proc || !proc.pid) return;
    this.info(`Terminating backend PID ${proc.pid}`);
    await killPid(proc.pid);
    if (this.proc === proc) {
      this.proc = null;
      this.owned = false;
    }
  }

  /** Stop the backend we own (reused external backends are left alone). */
  async stop() {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this._killOwned();
    this._setState('stopped', '');
  }

  /** Last-resort synchronous kill (process 'exit' handler). */
  stopSync() {
    this.stopping = true;
    const proc = this.proc;
    if (!proc || !proc.pid) return;
    try {
      if (process.platform === 'win32') {
        require('child_process').spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) {}
    this.proc = null;
  }
}

const backend = new BackendManager();

/** Small JSON helper for backend API calls from the main process. */
async function backendRequest(method, apiPath, body, timeoutMs = 5000) {
  const res = await fetch(`${BACKEND_ORIGIN}${apiPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method} ${apiPath}`);
  return res.json().catch(() => ({}));
}

module.exports = {
  backend,
  backendRequest,
  checkHealth,
  BACKEND_PORT,
  BACKEND_ORIGIN,
};
