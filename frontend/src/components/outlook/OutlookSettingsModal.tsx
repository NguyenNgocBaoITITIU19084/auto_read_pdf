import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, LogIn, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  clearOutlookConfig,
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

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const { addToast } = useToast();
  return (
    <button
      type="button"
      title="Sao chép"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        addToast('Đã sao chép', 'success');
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
    >
      <Copy className="w-3 h-3" />
      {label || 'Chép'}
    </button>
  );
};

export const OutlookSettingsModal: React.FC<Props> = ({ open, accounts, onClose, onAccountsChanged }) => {
  const { addToast } = useToast();
  const [config, setConfig] = useState<OutlookConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);

  const applyConfig = (cfg: OutlookConfig) => {
    setConfig(cfg);
    setClientId(cfg.client_id);
    setTenantId(cfg.tenant_id);
  };

  useEffect(() => {
    if (!open) return;
    getOutlookConfig()
      .then((cfg) => {
        applyConfig(cfg);
        // The app shipped in the build needs nothing entered: keep the technical part closed.
        setShowAdvanced(!cfg.has_oauth_config);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => () => stopPollRef.current?.(), []);

  if (!open) return null;

  const handleSave = async () => {
    if (!clientId.trim()) {
      addToast('Nhập Application (client) ID', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveOutlookConfig(clientId.trim(), tenantId.trim());
      applyConfig(await getOutlookConfig());
      addToast('Đã lưu ứng dụng Microsoft riêng', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.detail || 'Không lưu được cấu hình', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUseBuiltin = async () => {
    try {
      await clearOutlookConfig();
      const cfg = await getOutlookConfig();
      applyConfig(cfg);
      addToast(cfg.has_oauth_config ? 'Đã chuyển về ứng dụng có sẵn' : 'Đã xoá ứng dụng riêng', 'success');
    } catch {
      addToast('Không xoá được cấu hình', 'error');
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
  const ownApp = Boolean(config?.has_oauth_config && !config.using_builtin);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Tài khoản Outlook (Microsoft 365)</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* 1. accounts + the one button */}
          <section className="space-y-2.5">
            {accounts.length > 0 && (
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
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              {connecting
                ? 'Đang chờ đăng nhập trên trình duyệt...'
                : accounts.length > 0
                  ? 'Thêm tài khoản Microsoft'
                  : 'Đăng nhập bằng tài khoản Microsoft'}
            </button>
            {config && !config.has_oauth_config && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Bản cài này chưa có sẵn ứng dụng Microsoft. Nhập Application (client) ID ở mục Nâng cao bên dưới.
              </p>
            )}
          </section>

          {/* 2. when the company blocks self-consent: one link for IT */}
          {config?.admin_consent_url && (
            <section className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Đăng nhập báo “Cần quản trị viên phê duyệt”?
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                Gửi link này cho IT công ty. IT mở bằng tài khoản quản trị Microsoft 365 và bấm <b>Chấp nhận</b> một lần là cả
                công ty đăng nhập được. Sau khi chấp nhận, trang có thể để trắng — vẫn đã duyệt xong.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px]">
                  {config.admin_consent_url}
                </code>
                <CopyButton text={config.admin_consent_url} label="Chép link" />
              </div>
            </section>
          )}

          {/* 3. technical: use another Microsoft app */}
          <section className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between text-left cursor-pointer group"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 group-hover:text-primary-600">
                {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Nâng cao — dùng ứng dụng Microsoft riêng
              </span>
              {config?.has_oauth_config && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  {ownApp ? 'Đang dùng ứng dụng riêng' : 'Dùng ứng dụng có sẵn'}
                </span>
              )}
            </button>

            {showAdvanced && (
              <div className="space-y-3">
                <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  <li>Entra admin center → App registrations → New registration.</li>
                  <li>
                    Authentication → Mobile and desktop applications → redirect URI
                    <span className="inline-flex items-center gap-1 ml-1 align-middle">
                      <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">{redirect}</code>
                      <CopyButton text={redirect} />
                    </span>
                    , bật <b>Allow public client flows</b>.
                  </li>
                  <li>
                    API permissions (Delegated): <code>offline_access</code>, <code>User.Read</code>, <code>Mail.ReadWrite</code>,{' '}
                    <code>Mail.Send</code>.
                  </li>
                </ol>
                <label className="block space-y-1">
                  <span className="text-slate-500">Application (client) ID</span>
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className={inputCls}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500">Directory (tenant) ID — chỉ cần với ứng dụng một tổ chức</span>
                  <input
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    className={inputCls}
                    placeholder="để trống nếu ứng dụng nhiều tổ chức"
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  {ownApp && (
                    <button
                      type="button"
                      onClick={handleUseBuiltin}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Bỏ ứng dụng riêng
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
