import React, { useEffect, useRef, useState } from 'react';
import * as QRCode from 'qrcode';
import { Smartphone, Copy, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useMobileBridge } from '../../context/MobileBridgeContext';
import { tf } from '../../services/i18nFormat';

interface PhoneCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PhoneCaptureModal: React.FC<PhoneCaptureModalProps> = ({ isOpen, onClose }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const { session, queue, start, stop } = useMobileBridge();
  const p = t.booking.phone;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);

  // Start (or resume) a session whenever the modal opens and there isn't an active one already.
  useEffect(() => {
    if (!isOpen) return;
    if (session?.active) return;
    let cancelled = false;
    setStarting(true);
    setStartError(false);
    start()
      .catch(() => {
        if (!cancelled) setStartError(true);
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Redraw the QR code whenever the pairing URL changes (rescan / token rotation / refresh).
  useEffect(() => {
    const canvas = canvasRef.current;
    const url = session?.pair_url;
    if (!canvas || !url) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, url, { width: 240, margin: 1 }).catch((e) => {
      if (!cancelled) console.error('Failed to draw QR code:', e);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.pair_url]);

  const handleRetry = () => {
    setStarting(true);
    setStartError(false);
    start()
      .catch(() => setStartError(true))
      .finally(() => setStarting(false));
  };

  const handleCopyLink = async () => {
    if (!session?.pair_url) return;
    try {
      await navigator.clipboard.writeText(session.pair_url);
      addToast(t.common.copySuccess, 'success');
    } catch {
      addToast(t.common.error, 'error');
    }
  };

  const handleIpChange = (ip: string) => {
    if (!ip || ip === session?.selected_ip) return;
    setStarting(true);
    setStartError(false);
    start(ip)
      .catch(() => setStartError(true))
      .finally(() => setStarting(false));
  };

  const handleDisconnect = () => {
    void stop();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={p.modalTitle} maxWidth="max-w-lg">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
          <Smartphone className="w-5 h-5" />
          <span className="text-xs font-semibold">{p.scanHint}</span>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.sameWifiHint}</p>

        {/* QR code */}
        <div className="w-[240px] h-[240px] flex items-center justify-center bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          {startError ? (
            <div className="flex flex-col items-center gap-2 p-3">
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{p.startFailed}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.common.retry}</span>
              </button>
            </div>
          ) : starting || !session?.pair_url ? (
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          ) : (
            <canvas ref={canvasRef} width={240} height={240} />
          )}
        </div>

        {/* Raw link + copy */}
        {session?.pair_url && (
          <div className="w-full flex items-center gap-1.5">
            <input
              type="text"
              readOnly
              value={session.pair_url}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 truncate"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{p.copyLink}</span>
            </button>
          </div>
        )}

        {/* IP chooser */}
        {session?.ips && session.ips.length > 1 && (
          <div className="w-full flex items-center gap-2">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">
              {p.chooseIp}
            </label>
            <select
              value={session.selected_ip || ''}
              onChange={(e) => handleIpChange(e.target.value)}
              className="flex-1 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5"
            >
              {session.ips.map((ip) => (
                <option key={ip} value={ip}>
                  {ip}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Connected devices */}
        <div className="w-full text-left bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{p.devices}</span>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {tf(p.photosWaiting, { count: queue.length })}: {queue.length}
            </span>
          </div>
          {(!session?.devices || session.devices.length === 0) ? (
            <p className="text-[11px] text-slate-400">{p.noDevices}</p>
          ) : (
            <ul className="space-y-1">
              {session.devices.map((d) => (
                <li key={d.id} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {d.label}
                  </span>
                  <span className="text-slate-400">
                    {new Date(d.last_seen * 1000).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Troubleshoot */}
        <div className="w-full text-left">
          <button
            type="button"
            onClick={() => setShowTroubleshoot((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline"
          >
            <span>{p.troubleshootTitle}</span>
            {showTroubleshoot ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showTroubleshoot && (
            <ul className="mt-2 list-disc pl-5 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              {p.troubleshootItems.map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer buttons */}
        <div className="w-full flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleDisconnect}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 transition-colors"
          >
            {p.disconnect}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};
