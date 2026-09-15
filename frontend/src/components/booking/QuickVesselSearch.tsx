import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ship, Search, X, Loader2, Eye, Check, ExternalLink, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { Booking } from '../../types';
import { searchVesselsApi, addVesselWatchlist } from '../../services/api';
import { PORT_OPTIONS } from '../../utils/ports';
import {
  splitVesselVoyage,
  guessSiteFromDepot,
  getBookingVesselCandidates,
  formatEportDate,
  vesselLookupKey,
} from '../../utils/vessel';
import { tf } from '../../services/i18nFormat';
import type { TabId } from '../common/Tabs';

export interface QuickVesselSearchProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Partial<Booking> | null;
  /** When provided, shows "Open Vessels tab" on results. */
  onNavigateTab?: (tab: TabId, query?: string) => void;
}

const LAST_SITE_KEY = 'last_vessel_site_id';

const pick = (row: Record<string, any>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== 'null') return String(v).trim();
  }
  return '';
};

const readLastSite = (): string | null => {
  try {
    return localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
};

const errorText = (e: any, fallback: string): string => {
  const detail = e?.response?.data?.detail;
  return (typeof detail === 'string' && detail) || e?.message || fallback;
};

export const QuickVesselSearch: React.FC<QuickVesselSearchProps> = ({ isOpen, onClose, booking, onNavigateTab }) => {
  const { t, language, activeCollection } = useApp();
  const { addToast } = useToastActions();
  const qv = t.booking.quickVessel;

  const candidates = useMemo(() => getBookingVesselCandidates(booking), [booking]);
  const guessedSite = useMemo(() => guessSiteFromDepot(booking?.['Full return CY']), [booking]);

  const [sourceIdx, setSourceIdx] = useState(0);
  const [name, setName] = useState('');
  const [voyage, setVoyage] = useState('');
  const [site, setSite] = useState('CTL');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Record<string, any>[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(() => new Set());
  const [watchingKey, setWatchingKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const applyCandidate = useCallback((value: string) => {
    const split = splitVesselVoyage(value);
    setName(split.name);
    setVoyage(split.voyage);
  }, []);

  // Reset when opened for a booking
  useEffect(() => {
    if (!isOpen) {
      requestIdRef.current += 1;
      return;
    }
    setSourceIdx(0);
    applyCandidate(candidates[0]?.value || '');
    const lastSite = readLastSite();
    const validLast = lastSite && PORT_OPTIONS.some((p) => p.siteId === lastSite) ? lastSite : null;
    setSite(guessedSite || validLast || 'CTL');
    setResults(null);
    setMessage('');
    setError('');
    setSearching(false);
    setWatchedKeys(new Set());
    setWatchingKey(null);
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [isOpen, candidates, guessedSite, applyCandidate]);

  // Escape closes only this dialog (capture phase so parent modals don't also close)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeCollection) {
      addToast(qv.noCollection, 'error');
      return;
    }
    const vesselName = name.trim();
    if (!vesselName) {
      addToast(qv.nameRequired, 'error');
      nameInputRef.current?.focus();
      return;
    }
    const reqId = ++requestIdRef.current;
    setSearching(true);
    setError('');
    setMessage('');
    try {
      localStorage.setItem(LAST_SITE_KEY, site);
    } catch {
      /* ignore */
    }
    try {
      const res = await searchVesselsApi(activeCollection.id, site, vesselName, voyage.trim());
      if (reqId !== requestIdRef.current) return;
      const items: Record<string, any>[] = Array.isArray(res?.items) ? res.items : [];
      setResults(items);
      setMessage(items.length > 0 ? tf(qv.found, { count: items.length }) : res?.message || qv.notFound);
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return;
      setResults(null);
      setError(errorText(err, t.common.error));
    } finally {
      if (reqId === requestIdRef.current) setSearching(false);
    }
  };

  const handleWatch = async (siteId: string, vesselName: string, voy: string) => {
    if (!activeCollection || !vesselName) return;
    const key = vesselLookupKey(siteId, vesselName, voy);
    try {
      setWatchingKey(key);
      await addVesselWatchlist(activeCollection.id, siteId, vesselName, voy);
      setWatchedKeys((prev) => new Set(prev).add(key));
      addToast(tf(qv.watchSuccess, { name: voy ? `${vesselName} ${voy}` : vesselName }), 'success');
    } catch (err: any) {
      addToast(errorText(err, t.common.error), 'error');
    } finally {
      setWatchingKey(null);
    }
  };

  const formKey = vesselLookupKey(site, name.trim(), voyage.trim());
  const inputClass =
    'w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none';

  const content = (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <Ship className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            {qv.title}
            {booking?.['Booking No'] && booking['Booking No'] !== 'null' && (
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">· {booking['Booking No']}</span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
          <form onSubmit={handleSearch} className="space-y-2.5">
            {candidates.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{qv.source}:</span>
                {candidates.map((c, idx) => (
                  <button
                    key={c.source}
                    type="button"
                    onClick={() => {
                      setSourceIdx(idx);
                      applyCandidate(c.value);
                      setResults(null);
                      setMessage('');
                      setError('');
                    }}
                    aria-pressed={sourceIdx === idx}
                    className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                      sourceIdx === idx
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                    title={c.value}
                  >
                    {c.sources.join(' / ')}: <span className="font-bold">{c.value}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_170px] gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">{qv.vesselName}</label>
                <input ref={nameInputRef} type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="KOTA NEKAD" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">{qv.voyage}</label>
                <input type="text" value={voyage} onChange={(e) => setVoyage(e.target.value)} className={inputClass} placeholder="0272S" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">{qv.site}</label>
                <select value={site} onChange={(e) => setSite(e.target.value)} className={inputClass}>
                  {PORT_OPTIONS.map((p) => (
                    <option key={p.siteId} value={p.siteId}>
                      {language === 'en' ? p.nameEn : p.nameVi}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {guessedSite && guessedSite === site && booking?.['Full return CY']
                  ? `${qv.siteGuessed}: ${booking['Full return CY']}`
                  : ''}
              </span>
              <button
                type="submit"
                disabled={searching || !name.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-50"
              >
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {searching ? qv.searching : qv.search}
              </button>
            </div>
          </form>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {results !== null && !error && (
            <div className="space-y-2">
              <div
                className={`flex items-start gap-2 p-2 rounded-lg border ${
                  results.length > 0
                    ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                }`}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{message}</span>
              </div>

              {results.length === 0 && name.trim() && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{qv.watchNotFoundHint}</span>
                  <button
                    type="button"
                    disabled={watchedKeys.has(formKey) || watchingKey === formKey}
                    onClick={() => handleWatch(site, name.trim(), voyage.trim())}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-primary-300 dark:border-primary-800 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/50 disabled:opacity-60"
                  >
                    {watchingKey === formKey ? <Loader2 className="w-3 h-3 animate-spin" /> : watchedKeys.has(formKey) ? <Check className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {watchedKeys.has(formKey) ? qv.watched : qv.watch}
                  </button>
                </div>
              )}

              {results.map((row, idx) => {
                const rName = pick(row, 'VESSELNAME', 'vessel_name') || name.trim();
                const rVoy = pick(row, 'IN_OUT_VOYAGE', 'in_out_voyage');
                const rSite = pick(row, 'SITE_ID', 'site_id') || site;
                const key = vesselLookupKey(rSite, rName, rVoy);
                const cells: [string, string][] = [
                  [qv.berth, formatEportDate(pick(row, 'ACTUAL_BERTH_TIME', 'actual_berth_time'))],
                  [qv.departure, formatEportDate(pick(row, 'ACTUAL_DEPATURE_TIME', 'ACTUAL_DEPARTURE_TIME', 'actual_departure_time'))],
                  [qv.closing, formatEportDate(pick(row, 'CLOSING_TIME', 'closing_time'))],
                  [qv.closingIcd, formatEportDate(pick(row, 'CLOSING_TIME_ICD', 'closing_time_icd'))],
                  [qv.openTs, formatEportDate(pick(row, 'OPEN_TS', 'open_ts'))],
                  [qv.agent, pick(row, 'AGENT', 'agent')],
                ];
                return (
                  <div key={`${key}-${idx}`} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Ship className="w-4 h-4 text-primary-500 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{rName}</span>
                        {rVoy && <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-mono font-bold text-[11px] text-slate-700 dark:text-slate-200">{rVoy}</span>}
                        <span className="text-[10px] font-bold text-slate-400">{rSite}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={watchedKeys.has(key) || watchingKey === key}
                          onClick={() => handleWatch(rSite, rName, rVoy)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border border-primary-300 dark:border-primary-800 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/50 disabled:opacity-60"
                        >
                          {watchingKey === key ? <Loader2 className="w-3 h-3 animate-spin" /> : watchedKeys.has(key) ? <Check className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {watchedKeys.has(key) ? qv.watched : qv.watch}
                        </button>
                        {onNavigateTab && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onNavigateTab('vessel', rName);
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {qv.openVesselTab}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                      {cells.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                          <div className={`truncate ${value ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-400 italic'}`} title={value}>
                            {value || '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {results.length > 0 && !onNavigateTab && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">{qv.savedHint}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
