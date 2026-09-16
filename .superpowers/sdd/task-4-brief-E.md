### Task 4: Frontend gửi lỗi + màn hình "Nhật ký hệ thống"

**Files:**
- Create: `frontend/src/services/clientLogger.ts`, `frontend/src/services/clientLogger.test.ts`
- Modify: `frontend/src/services/api.ts` (interceptor + hàm log), `frontend/src/main.tsx`, `frontend/src/components/common/ErrorBoundary.tsx`
- Create: `frontend/src/components/common/LogViewerModal.tsx`
- Modify: `frontend/src/components/common/BackupModal.tsx` (thẻ "Nhật ký hệ thống"), `frontend/src/components/vessel/tableHelpers.ts:146-149` (`errorMessage` hiện mã tra cứu)
- Modify: `frontend/src/i18n/translations.ts` (section mới `logs` trong `vi` và `en`)

**Interfaces:**
- Consumes: `POST /logs/client`, `GET /logs`, `GET /logs/export`, header `X-Request-ID` (Task 2-3); `window.electronAPI.openLogFolder`
- Produces (TS):
  ```ts
  // clientLogger.ts
  export type ClientLogLevel = 'error' | 'warning' | 'info';
  export function reportClientLog(level: ClientLogLevel, message: string, extra?: { stack?: string; context?: Record<string, unknown> }): void
  export function installGlobalErrorLogging(): () => void
  export function __resetClientLoggerForTests(): void
  export function setClientLogTransport(fn: (payload: ClientLogPayload) => Promise<unknown>): void
  // api.ts
  export interface LogEntry { time: string; level: string; logger: string; request_id: string; message: string }
  export const sendClientLogApi: (payload: ClientLogPayload) => Promise<void>
  export const getLogsApi: (params: { source?: 'app' | 'errors'; level?: string; q?: string; limit?: number }) => Promise<{ entries: LogEntry[]; log_dir: string }>
  export const downloadLogsZipApi: () => Promise<{ blob: Blob; filename: string }>
  ```
- Quy tắc `reportClientLog`:
  - Cùng `level+message` trong 30 giây chỉ gửi 1 lần.
  - Không bao giờ throw.
  - Không gửi lỗi phát sinh từ chính request `/logs/client` (tránh lặp vòng).
  - Transport mặc định là `sendClientLogApi`; test thay bằng `setClientLogTransport`.
- Interceptor axios:
  - Lỗi mạng (không có `response`) → `warning` với message `Network error: GET /vessels/page`.
  - HTTP ≥ 500 → `error` với message `HTTP 500: POST /bookings/upload`, context `{request_id}`.
  - Luôn `Promise.reject(error)` như cũ.

- [ ] **Step 1: Viết test thất bại**

`frontend/src/services/clientLogger.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reportClientLog, installGlobalErrorLogging, setClientLogTransport, __resetClientLoggerForTests } from './clientLogger';

describe('clientLogger', () => {
  const transport = vi.fn(async () => undefined);

  beforeEach(() => {
    __resetClientLoggerForTests();
    transport.mockClear();
    setClientLogTransport(transport);
  });

  it('sends a payload with url and version', () => {
    reportClientLog('error', 'boom', { stack: 'at X' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toMatchObject({ level: 'error', message: 'boom', stack: 'at X' });
    expect(transport.mock.calls[0][0].url).toBeTruthy();
  });

  it('dedupes the same message within 30s', () => {
    vi.useFakeTimers();
    reportClientLog('error', 'same');
    reportClientLog('error', 'same');
    expect(transport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    reportClientLog('error', 'same');
    expect(transport).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('never throws when the transport fails', () => {
    setClientLogTransport(() => { throw new Error('offline'); });
    expect(() => reportClientLog('error', 'x')).not.toThrow();
  });

  it('captures window errors and unhandled rejections', () => {
    const uninstall = installGlobalErrorLogging();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error A', error: new Error('A') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('B rejected') });
    window.dispatchEvent(rejection);
    uninstall();
    const messages = transport.mock.calls.map((c) => c[0].message);
    expect(messages).toContain('Script error A');
    expect(messages.some((m: string) => m.includes('B rejected'))).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `cd frontend && npm test -- clientLogger`
Expected: FAIL — không resolve `./clientLogger`

- [ ] **Step 3: Cài đặt `clientLogger.ts`**

```ts
export type ClientLogLevel = 'error' | 'warning' | 'info';

export interface ClientLogPayload {
  level: ClientLogLevel;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
  app_version?: string;
}

const DEDUPE_MS = 30_000;
const APP_VERSION = (import.meta as any).env?.VITE_APP_VERSION || '';
let lastSent = new Map<string, number>();
let transport: ((payload: ClientLogPayload) => Promise<unknown>) | null = null;

export function setClientLogTransport(fn: (payload: ClientLogPayload) => Promise<unknown>) {
  transport = fn;
}

export function __resetClientLoggerForTests() {
  lastSent = new Map();
}

export function reportClientLog(
  level: ClientLogLevel,
  message: string,
  extra: { stack?: string; context?: Record<string, unknown> } = {}
): void {
  try {
    const text = String(message || 'Unknown error').slice(0, 2000);
    const key = `${level}|${text}`;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev !== undefined && now - prev < DEDUPE_MS) return;
    lastSent.set(key, now);
    if (lastSent.size > 200) lastSent = new Map([...lastSent].slice(-100));
    if (!transport) return;
    const payload: ClientLogPayload = {
      level, message: text, stack: extra.stack?.slice(0, 8000), context: extra.context,
      url: typeof window !== 'undefined' ? window.location.href : undefined, app_version: APP_VERSION || undefined,
    };
    Promise.resolve(transport(payload)).catch(() => undefined);
  } catch {
    /* logging must never break the app */
  }
}

export function installGlobalErrorLogging(): () => void {
  const onError = (event: ErrorEvent) => {
    reportClientLog('error', event.message || String(event.error), { stack: event.error?.stack });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: any = event.reason;
    if (reason?.isAxiosError) return; // already reported by the axios interceptor
    reportClientLog('error', `Unhandled rejection: ${reason?.message || String(reason)}`, { stack: reason?.stack });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
```
Trong `vite.config.ts` thêm `define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '') }`.

- [ ] **Step 4: Chạy test**

Run: `cd frontend && npm test -- clientLogger`
Expected: PASS

- [ ] **Step 5: API + interceptor + gắn vào app**

`api.ts` — sau `apiClient = axios.create(...)`:
```ts
import { reportClientLog, setClientLogTransport, ClientLogPayload } from './clientLogger';

export interface LogEntry { time: string; level: string; logger: string; request_id: string; message: string }

export const sendClientLogApi = async (payload: ClientLogPayload): Promise<void> => {
  await apiClient.post('/logs/client', payload, { timeout: 10000 });
};
setClientLogTransport(sendClientLogApi);

apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    const cfg = error?.config || {};
    const target = `${String(cfg.method || 'get').toUpperCase()} ${cfg.url || ''}`;
    if (!String(cfg.url || '').includes('/logs/client')) {
      if (!error?.response) {
        reportClientLog('warning', `Network error: ${target}`, { context: { code: error?.code } });
      } else if (error.response.status >= 500) {
        reportClientLog('error', `HTTP ${error.response.status}: ${target}`, {
          context: { request_id: error.response.headers?.['x-request-id'], detail: error.response.data?.detail },
        });
      }
    }
    return Promise.reject(error);
  }
);

export const getLogsApi = async (params: { source?: 'app' | 'errors'; level?: string; q?: string; limit?: number }) =>
  (await apiClient.get<{ entries: LogEntry[]; log_dir: string }>('/logs', { params })).data;

export const downloadLogsZipApi = async (): Promise<{ blob: Blob; filename: string }> => {
  const res = await apiClient.get('/logs/export', { responseType: 'blob', timeout: LONG_TIMEOUT });
  const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] || '');
  return { blob: res.data, filename: match?.[1] || 'auto-read-pdf-logs.zip' };
};
```
Để CORS trả header `content-disposition`, thêm `"Content-Disposition"` vào `expose_headers` trong `main.py` (bên cạnh `X-Request-ID` ở Task 2).

`main.tsx` — trước `ReactDOM.createRoot`: `import { installGlobalErrorLogging } from './services/clientLogger';` và gọi `installGlobalErrorLogging();`.

`ErrorBoundary.tsx` — `componentDidCatch`:
```tsx
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
    reportClientLog('error', `React render error: ${error.message}`, {
      stack: `${error.stack || ''}\nComponent stack:${errorInfo.componentStack || ''}`,
    });
  }
```

`tableHelpers.ts` `errorMessage` — nối mã tra cứu khi backend trả lỗi 500:
```ts
export const errorMessage = (e: any, fallback: string): string => {
  const data = e?.response?.data;
  const detail = typeof data?.detail === 'string' ? data.detail : '';
  const rid = data?.request_id || e?.response?.headers?.['x-request-id'];
  const base = detail || e?.message || fallback;
  return rid && e?.response?.status >= 500 && !base.includes(rid) ? `${base} (mã: ${rid})` : base;
};
```

- [ ] **Step 6: Chuỗi dịch** — thêm section `logs` vào `vi` (cạnh `bulk`):
```ts
    logs: {
      cardTitle: "Nhật ký hệ thống",
      cardDesc: "Xem lỗi phát sinh khi sử dụng, xuất file gửi bộ phận hỗ trợ.",
      view: "Xem nhật ký",
      export: "Xuất file log (.zip)",
      openFolder: "Mở thư mục log",
      modalTitle: "Nhật ký hệ thống",
      sourceApp: "Tất cả hoạt động",
      sourceErrors: "Chỉ cảnh báo & lỗi",
      levelAll: "Mọi mức",
      searchPlaceholder: "Tìm theo nội dung hoặc mã tra cứu...",
      refresh: "Tải lại",
      empty: "Không có dòng nhật ký phù hợp",
      copied: "Đã sao chép dòng nhật ký",
      exportSuccess: "Đã xuất file nhật ký",
      location: "Thư mục: {path}"
    },
```
và `en`:
```ts
    logs: {
      cardTitle: "System logs",
      cardDesc: "See errors that happened while using the app and export a file for support.",
      view: "View logs",
      export: "Export logs (.zip)",
      openFolder: "Open log folder",
      modalTitle: "System logs",
      sourceApp: "All activity",
      sourceErrors: "Warnings & errors only",
      levelAll: "All levels",
      searchPlaceholder: "Search message or lookup code...",
      refresh: "Refresh",
      empty: "No matching log entries",
      copied: "Log entry copied",
      exportSuccess: "Log file exported",
      location: "Folder: {path}"
    },
```

- [ ] **Step 7: `LogViewerModal.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Copy, Search, ChevronRight } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { getLogsApi, LogEntry } from '../../services/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tf } from '../../services/i18nFormat';
import { errorMessage } from '../vessel/tableHelpers';

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  CRITICAL: 'bg-rose-600 text-white',
  WARNING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  INFO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  DEBUG: 'bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500',
};

export const LogViewerModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t, addToast } = useApp();
  const [source, setSource] = useState<'app' | 'errors'>('errors');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 300);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [logDir, setLogDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLogsApi({ source, level: level || undefined, q: q || undefined, limit: 300 });
      setEntries(res.entries);
      setLogDir(res.log_dir);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setLoading(false);
    }
  }, [source, level, q, addToast, t]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const copyEntry = async (e: LogEntry) => {
    await navigator.clipboard.writeText(`${e.time} [${e.level}] [${e.logger}] [req=${e.request_id}] ${e.message}`);
    addToast(t.logs.copied, 'success');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.logs.modalTitle} maxWidth="max-w-5xl">
      <div className="flex flex-col gap-3 min-h-[60vh]">
        <div className="flex flex-wrap items-center gap-2">
          <select value={source} onChange={(e) => setSource(e.target.value as 'app' | 'errors')}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <option value="errors">{t.logs.sourceErrors}</option>
            <option value="app">{t.logs.sourceApp}</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <option value="">{t.logs.levelAll}</option>
            <option value="WARNING">WARNING+</option>
            <option value="ERROR">ERROR+</option>
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.logs.searchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500" />
          </div>
          <button type="button" onClick={load} title={t.logs.refresh}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 overflow-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
          {entries.length === 0 && !loading && (
            <div className="py-12 text-center text-slate-400 font-sans text-xs">{t.logs.empty}</div>
          )}
          {entries.map((e, i) => {
            const multiline = e.message.includes('\n');
            const open = expanded === i;
            return (
              <div key={`${e.time}-${i}`} className="group px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="flex items-start gap-2">
                  <button type="button" disabled={!multiline} onClick={() => setExpanded(open ? null : i)}
                    className="mt-0.5 text-slate-400 disabled:opacity-0">
                    <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  <span className="text-slate-400 whitespace-nowrap">{e.time}</span>
                  <span className={`px-1.5 rounded font-bold ${LEVEL_BADGE[e.level] || LEVEL_BADGE.INFO}`}>{e.level}</span>
                  <span className="text-slate-500 whitespace-nowrap">{e.logger}</span>
                  {e.request_id !== '-' && <span className="text-primary-600 dark:text-primary-400 whitespace-nowrap">#{e.request_id}</span>}
                  <span className="flex-1 min-w-0 text-slate-800 dark:text-slate-200 break-words">
                    {open ? <pre className="whitespace-pre-wrap">{e.message}</pre> : e.message.split('\n')[0]}
                  </span>
                  <button type="button" onClick={() => copyEntry(e)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-primary-600">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {logDir && <p className="text-[11px] text-slate-400">{tf(t.logs.location, { path: logDir })}</p>}
      </div>
    </Modal>
  );
};
```

- [ ] **Step 8: Thẻ trong `BackupModal`** — thêm state `const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);` và hàm:
```tsx
  const handleExportLogs = async () => {
    try {
      setLoading(true);
      const { blob, filename } = await downloadLogsZipApi();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      addToast(t.logs.exportSuccess, 'success');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setLoading(false);
    }
  };
```
Thêm thẻ sau khối "Restore Backup JSON" (cùng kiểu class với thẻ khôi phục):
```tsx
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.logs.cardTitle}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.logs.cardDesc}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setIsLogViewerOpen(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
              <ScrollText className="w-4 h-4" />{t.logs.view}
            </button>
            <button type="button" disabled={loading} onClick={handleExportLogs} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">
              <FileArchive className="w-4 h-4" />{t.logs.export}
            </button>
            {window.electronAPI?.openLogFolder && (
              <button type="button" onClick={() => window.electronAPI?.openLogFolder?.()} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                <FolderOpen className="w-4 h-4" />{t.logs.openFolder}
              </button>
            )}
          </div>
        </div>
        <LogViewerModal isOpen={isLogViewerOpen} onClose={() => setIsLogViewerOpen(false)} />
```
Imports: `ScrollText, FileArchive, FolderOpen` từ `lucide-react`; `downloadLogsZipApi` từ `../../services/api`; `LogViewerModal` từ `./LogViewerModal`; `errorMessage` từ `../vessel/tableHelpers`.
Lưu ý: `LogViewerModal` nằm trong `BackupModal` nên cả hai được nạp lười cùng lúc (kế hoạch C Task 9).

- [ ] **Step 9: Build + thủ công**

Run: `cd frontend && npm test && npm run build`
Thủ công (`npm run dev`):
1. Tắt backend (kill process) → thao tác tải bảng → bật lại → Cài đặt → "Xem nhật ký" (Chỉ cảnh báo & lỗi) có dòng `[frontend] Network error: GET ...`.
2. Tạm thêm `throw new Error('test render')` vào render của `DashboardTab` → màn lỗi hiện ra, nhật ký có `React render error: test render` kèm component stack (xoá dòng throw sau khi thử).
3. "Xuất file log (.zip)" → giải nén thấy `logs/app.log`, `system_info.json`; tìm Gemini key trong zip (`unzip -p x.zip | grep AIza`) → không thấy.
4. "Mở thư mục log" (bản Electron) mở đúng thư mục.
Expected: đạt cả 4.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/services/clientLogger.ts frontend/src/services/clientLogger.test.ts frontend/src/services/api.ts frontend/src/main.tsx frontend/src/components/common/ErrorBoundary.tsx frontend/src/components/common/LogViewerModal.tsx frontend/src/components/common/BackupModal.tsx frontend/src/components/vessel/tableHelpers.ts frontend/src/i18n/translations.ts frontend/vite.config.ts backend/app/main.py
git commit -m "feat(logging): report frontend errors and add a system log viewer with zip export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

