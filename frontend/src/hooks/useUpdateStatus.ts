import { useCallback, useEffect, useState } from 'react';
import { UpdateStatus } from '../types';

/**
 * Live auto-update status from the Electron main process.
 * Outside Electron (browser / LAN mode) it stays 'unsupported'.
 */
export const useUpdateStatus = () => {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unsupported' });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.onUpdateStatus) return;
    const unsubscribe = api.onUpdateStatus(setStatus);
    api.getUpdateStatus?.().then(setStatus).catch(() => {});
    return unsubscribe;
  }, []);

  const check = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.checkForUpdates) return;
    setChecking(true);
    try {
      setStatus(await api.checkForUpdates());
    } catch (e) {
      /* the main process also pushes an 'error' status */
    } finally {
      setChecking(false);
    }
  }, []);

  const install = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.installUpdate) return false;
    return api.installUpdate().catch(() => false);
  }, []);

  return { status, checking, check, install };
};
