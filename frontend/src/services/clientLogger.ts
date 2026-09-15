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
