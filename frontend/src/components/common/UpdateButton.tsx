import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';
import { getBackendVersionApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { Tooltip } from './Tooltip';

const RELEASES_URL = 'https://github.com/NguyenNgocBaoITITIU19084/auto_read_pdf/releases/latest';

const chipBase =
  'flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md border transition-colors cursor-pointer whitespace-nowrap';
const chipIdle =
  'bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800/80 hover:bg-primary-100 dark:hover:bg-primary-900/60';

/**
 * Version chip in the header that doubles as the update control: click to check, shows download
 * progress, and turns into a green "Cập nhật x.y.z" button once an update is ready to install.
 * Where auto-update is unavailable (macOS, browser, dev run) it opens the releases page instead.
 */
export const UpdateButton: React.FC = () => {
  const { t, addToast } = useApp();
  const confirm = useConfirm();
  const u = t.appUpdate;
  const { status, checking, check, install } = useUpdateStatus();
  const [backendVersion, setBackendVersion] = useState('');
  const [installing, setInstalling] = useState(false);
  const manualRef = useRef(false);

  const electronVersion = status.currentVersion || window.electronAPI?.version || '';
  const version = electronVersion || backendVersion;

  // Outside Electron the app version comes from the backend
  useEffect(() => {
    if (electronVersion) return;
    getBackendVersionApi().then(setBackendVersion).catch(() => {});
  }, [electronVersion]);

  // Answer a manual click once the main process reports the outcome
  const { state } = status;
  useEffect(() => {
    if (!manualRef.current) return;
    if (state === 'up-to-date') {
      addToast(version ? tf(u.upToDate, { version }) : u.upToDateNoVersion, 'success');
      manualRef.current = false;
    } else if (state === 'downloading') {
      addToast(tf(u.downloading, { version: status.version || '', percent: status.percent ?? 0 }), 'info');
      manualRef.current = false;
    } else if (state === 'error') {
      addToast(tf(u.errorToast, { error: status.error || '' }), 'error');
      manualRef.current = false;
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const openReleases = () => {
    const url = status.releasesUrl || RELEASES_URL;
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url).catch(() => {});
    else window.open(url, '_blank', 'noopener');
  };

  const handleInstall = async () => {
    const ok = await confirm({
      title: u.installTitle,
      message: tf(u.installMessage, { version: status.version || '' }),
      confirmText: u.installConfirm,
    });
    if (!ok) return;
    setInstalling(true);
    install().finally(() => setInstalling(false));
  };

  const label = version ? `v${version}` : 'v—';
  const busy = checking || state === 'checking';

  if (state === 'downloaded') {
    return (
      <Tooltip content={tf(u.readyTip, { version: status.version || '' })} position="bottom">
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/30 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
        >
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-white/70 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-white" />
          </span>
          <ArrowDownToLine className="w-3 h-3" />
          {tf(u.ready, { version: status.version || '' })}
        </button>
      </Tooltip>
    );
  }

  if (state === 'downloading') {
    const percent = status.percent ?? 0;
    return (
      <Tooltip content={tf(u.downloading, { version: status.version || '', percent })} position="bottom">
        <span className={`${chipBase} ${chipIdle} cursor-default`}>
          <Loader2 className="w-3 h-3 animate-spin" />
          {tf(u.downloadingShort, { percent })}
        </span>
      </Tooltip>
    );
  }

  if (state === 'unsupported') {
    return (
      <Tooltip content={window.electronAPI?.platform ? u.openReleases : u.notPackaged} position="bottom">
        <button type="button" onClick={openReleases} className={`${chipBase} ${chipIdle}`}>
          {label}
          <ArrowDownToLine className="w-3 h-3" />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      content={
        state === 'error'
          ? tf(u.error, { error: status.error || '' })
          : busy
            ? u.checking
            : version
              ? tf(u.versionTip, { version })
              : u.versionTipUnknown
      }
      position="bottom"
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          manualRef.current = true;
          check();
        }}
        className={`${chipBase} ${
          state === 'error'
            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
            : chipIdle
        } disabled:cursor-wait`}
      >
        {label}
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : state === 'error' ? (
          <TriangleAlert className="w-3 h-3" />
        ) : (
          <RefreshCw className="w-3 h-3" />
        )}
      </button>
    </Tooltip>
  );
};
