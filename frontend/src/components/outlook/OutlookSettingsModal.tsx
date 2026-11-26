import React, { useEffect, useRef, useState } from 'react';
import { Copy, LogIn, Trash2, X } from 'lucide-react';
import {
  deleteOutlookAccount,
  getOutlookAccounts,
  getOutlookConfig,
  OutlookAccount,
  OutlookConfig,
  saveOutlookConfig,
  startOutlookOAuth,
} from '../../services/outlookApi';
import { useToast } from '../../context/ToastContext';

interface Props {
  open: boolean;
  accounts: OutlookAccount[];
  onClose: () => void;
  onAccountsChanged: () => void;
}

const inputCls =
  'w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';

/** Open Microsoft sign-in in the system browser, then wait for the new account to show up. */
export async function connectOutlookAccount(
  knownCount: number,
  onConnected: () => void,
  onError: (msg: string) => void
): Promise<() => void> {
  const { auth_url } = await startOutlookOAuth();
  if (window.electronAPI?.openExternal) await window.electronAPI.openExternal(auth_url);
  else window.open(auth_url, '_blank', 'noopener,noreferrer');
  const started = Date.now();
  const timer = window.setInterval(async () => {
    if (Date.now() - started > 5 * 60 * 1000) {
      window.clearInterval(timer);
      onError('Hết thời gian chờ đăng nhập Microsoft. Hãy thử lại.');
      return;
    }
    try {
      const list = await getOutlookAccounts();
      if (list.length > knownCount) {
        window.clearInterval(timer);
        onConnected();
      }
    } catch {
      /* keep waiting */
    }
  }, 2000);
  return () => window.clearInterval(timer);
}

export const OutlookSettingsModal: React.FC<Props> = ({ open, accounts, onClose, onAccountsChanged }) => {
  const { addToast } = useToast();
  const [config, setConfig] = useState<OutlookConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    getOutlookConfig()
      .then((cfg) => {
        setConfig(cfg);
        setClientId(cfg.client_id);
        setTenantId(cfg.tenant_id);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => () => stopPollRef.current?.(), []);

  if (!open) return null;

  const handleSave = async () => {
    if (!clientId.trim() || !tenantId.trim()) {
      addToast('Nhập đủ Application (client) ID và Directory (tenant) ID do IT cung cấp', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveOutlookConfig(clientId.trim(), tenantId.trim());
      setConfig(await getOutlookConfig());
      addToast('Đã lưu cấu hình Microsoft 365', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.detail || 'Không lưu được cấu hình', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      stopPollRef.current?.();
      stopPollRef.current = await connectOutlookAccount(
        accounts.length,
        () => {
          setConnecting(false);
          addToast('Đã kết nối tài khoản Outlook', 'success');
          onAccountsChanged();
        },
        (msg) => {
          setConnecting(false);
          addToast(msg, 'error');
        }
      );
    } catch (err: any) {
      setConnecting(false);
      addToast(err?.response?.data?.detail || 'Không mở được trang đăng nhập Microsoft', 'error');
    }
  };

  const handleRemove = async (acc: OutlookAccount) => {
    if (!window.confirm(`Ngắt kết nối ${acc.email} khỏi ứng dụng? Thư trong Outlook không bị ảnh hưởng.`)) return;
    try {
      await deleteOutlookAccount(acc.id);
      onAccountsChanged();
    } catch {
      addToast('Không ngắt kết nối được', 'error');
    }
  };

  const redirect = config ? `http://localhost${config.redirect_path}` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Cài đặt Outlook (Microsoft 365)</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <section className="space-y-2">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200">Tài khoản đã kết nối</h4>
            {accounts.length === 0 ? (
              <p className="text-slate-500">Chưa có tài khoản nào.</p>
            ) : (
              <ul className="space-y-1.5">
                {accounts.map((acc) => (
                  <li
                    key={acc.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{acc.display_name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{acc.email}</div>
                      {acc.status === 'error' && (
                        <div className="text-[11px] text-rose-500 truncate">{acc.last_error || 'Cần đăng nhập lại'}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(acc)}
                      title="Ngắt kết nối"
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting || !config?.has_oauth_config}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              {connecting ? 'Đang chờ đăng nhập trên trình duyệt...' : 'Đăng nhập bằng tài khoản Microsoft'}
            </button>
            {!config?.has_oauth_config && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Cần nhập Application (client) ID và Directory (tenant) ID bên dưới trước khi đăng nhập.
              </p>
            )}
          </section>

          <section className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200">Ứng dụng Microsoft Entra (do IT cấu hình)</h4>
            <ol className="list-decimal pl-4 space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed">
              <li>Entra admin center → App registrations → New registration, chọn “Accounts in this organizational directory only”.</li>
              <li>
                Authentication → Add a platform → <b>Mobile and desktop applications</b> → Custom redirect URI:
                <span className="inline-flex items-center gap-1 ml-1">
                  <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">{redirect}</code>
                  <button
                    type="button"
                    title="Sao chép"
                    onClick={() => {
                      navigator.clipboard?.writeText(redirect).catch(() => {});
                      addToast('Đã sao chép', 'success');
                    }}
                    className="p-0.5 text-slate-400 hover:text-primary-600 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </span>
              </li>
              <li>
                API permissions → Microsoft Graph → Delegated: <code>offline_access</code>, <code>User.Read</code>,{' '}
                <code>Mail.ReadWrite</code>, <code>Mail.Send</code> → <b>Grant admin consent</b>.
              </li>
              <li>
                Authentication → Advanced settings → <b>Allow public client flows: Yes</b>. Không cần tạo Client secret.
              </li>
              <li>Gửi lại Application (client) ID và Directory (tenant) ID.</li>
            </ol>
            <label className="block space-y-1">
              <span className="text-slate-500">Application (client) ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </label>
            <label className="block space-y-1">
              <span className="text-slate-500">Directory (tenant) ID</span>
              <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={inputCls} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 font-medium cursor-pointer"
            >
              {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
