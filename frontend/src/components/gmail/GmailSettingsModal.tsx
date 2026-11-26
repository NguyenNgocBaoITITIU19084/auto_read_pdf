import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, KeyRound, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  deleteGmailAccount,
  getGmailConfig,
  GmailAccount,
  GmailConfig,
  saveGmailOAuthConfig,
  startGmailOAuth,
  syncGmailAccount,
} from '../../services/gmailApi';
import { useToast } from '../../context/ToastContext';

interface GmailSettingsModalProps {
  open: boolean;
  accounts: GmailAccount[];
  onClose: () => void;
  onAccountsChanged: () => void;
}

export const GmailSettingsModal: React.FC<GmailSettingsModalProps> = ({
  open,
  accounts,
  onClose,
  onAccountsChanged,
}) => {
  const { addToast: showToast } = useToast();
  const [config, setConfig] = useState<GmailConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [showAdvancedOAuth, setShowAdvancedOAuth] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    getGmailConfig()
      .then((cfg) => {
        setConfig(cfg);
        setClientId(cfg.client_id || '');
        setClientSecret('');
        setShowAdvancedOAuth(!cfg.has_oauth_config);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  if (!open) return null;

  const handleSaveOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim()) {
      showToast('Vui lòng nhập Google OAuth Client ID', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveGmailOAuthConfig(clientId.trim(), clientSecret.trim());
      const updated = await getGmailConfig();
      setConfig(updated);
      setClientSecret('');
      showToast('Đã lưu cấu hình Google OAuth', 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Không lưu được cấu hình', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      const { auth_url } = await startGmailOAuth();
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(auth_url);
      } else {
        window.open(auth_url, '_blank', 'noopener,noreferrer');
      }
      showToast('Đã mở trình duyệt để đăng nhập Google. Vui lòng xác nhận trên trình duyệt...', 'info');
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      let ticks = 0;
      pollTimerRef.current = window.setInterval(() => {
        ticks += 1;
        onAccountsChanged();
        if (ticks >= 45 && pollTimerRef.current) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }, 2000);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Không khởi tạo được đăng nhập Google', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteAccount = async (acc: GmailAccount) => {
    try {
      await deleteGmailAccount(acc.id);
      showToast(`Đã ngắt kết nối ${acc.email}`, 'success');
      onAccountsChanged();
    } catch {
      showToast('Không thể xóa tài khoản', 'error');
    }
  };

  const handleSyncNow = async (acc: GmailAccount) => {
    try {
      const res = await syncGmailAccount(acc.id);
      showToast(`Đã đồng bộ ${res.synced_threads} hội thoại cho ${acc.email}`, 'success');
      onAccountsChanged();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Đồng bộ thất bại', 'error');
    }
  };

  const copyRedirectUri = () => {
    if (!config?.redirect_uri) return;
    navigator.clipboard.writeText(config.redirect_uri).then(() => {
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 1800);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Cấu hình & Tài khoản Gmail
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6 text-xs">
          {/* Connected accounts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Tài khoản đã kết nối ({accounts.length})
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onAccountsChanged}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Làm mới
                </button>
                <button
                  type="button"
                  onClick={handleConnectGmail}
                  disabled={connecting || !config?.has_oauth_config}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {connecting ? 'Đang mở trình duyệt...' : 'Kết nối tài khoản Gmail'}
                </button>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500">
                Chưa có tài khoản Gmail nào. Lưu Client ID bên dưới rồi bấm &ldquo;Kết nối tài khoản Gmail&rdquo;.
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {acc.avatar ? (
                        <img src={acc.avatar} alt="" className="w-8 h-8 rounded-full shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 flex items-center justify-center font-bold shrink-0">
                          {acc.email[0]?.toUpperCase() || 'G'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {acc.display_name || acc.email}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {acc.email} • {acc.status === 'error' ? `Lỗi: ${acc.last_error}` : `Đồng bộ: ${acc.last_sync_at || 'Chưa'}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSyncNow(acc)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                        title="Đồng bộ ngay"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAccount(acc)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                        title="Ngắt kết nối"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* OAuth Client Config (collapsible when already configured) */}
          <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowAdvancedOAuth((v) => !v)}
              className="w-full flex items-center justify-between text-left cursor-pointer group"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 text-xs group-hover:text-primary-600">
                {showAdvancedOAuth ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Cấu hình nâng cao (Dành cho kỹ thuật — Google OAuth Client ID)
              </span>
              {config?.has_oauth_config && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Đã cấu hình sẵn
                </span>
              )}
            </button>

            {showAdvancedOAuth && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Chỉ cần nhập nếu bạn muốn dùng Google Cloud Client ID riêng.
                  </span>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                  >
                    Mở Google Cloud Console <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 space-y-1.5">
                  <p className="font-medium">Hướng dẫn nhanh:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                    <li>Bật <strong>Gmail API</strong> trong Google Cloud Project của bạn.</li>
                    <li>Tạo <strong>OAuth Client ID</strong> (loại <em>Desktop app</em> hoặc <em>Web application</em>).</li>
                    <li>Nếu dùng Web application, thêm Redirect URI bên dưới vào mục <em>Authorized redirect URIs</em>:</li>
                  </ol>
                  {config?.redirect_uri && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <code className="flex-1 px-2.5 py-1 rounded bg-white/80 dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-[11px] select-all">
                        {config.redirect_uri}
                      </code>
                      <button
                        type="button"
                        onClick={copyRedirectUri}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 text-[11px] font-medium cursor-pointer"
                      >
                        {copiedUri ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedUri ? 'Đã chép' : 'Chép'}
                      </button>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSaveOAuth} className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Google Client ID
                    </label>
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="xxxxxx.apps.googleusercontent.com"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Client Secret {config?.has_client_secret ? '(đã lưu — để trống nếu không đổi)' : '(tùy chọn với Desktop app)'}
                    </label>
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="GOCSPX-..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      {saving ? 'Đang lưu...' : 'Lưu cấu hình OAuth'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
