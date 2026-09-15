import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Clock, Plus, X, Loader2, Play, CalendarClock, History, Check, Timer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AutoSyncMode, AutoSyncSchedule } from '../../types';
import { formatDateTimeShort } from '../../services/i18nFormat';
import { normalizeSyncTimes, scheduleFromStatus, isValidSyncTime } from '../../services/autoSync';

const PRESETS = [
  { label: '5p', value: 5 },
  { label: '15p', value: 15 },
  { label: '30p', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
  { label: '4h', value: 240 },
];

const APPLY_DEBOUNCE_MS = 900;

// Only compare the fields that matter for the active mode (the times draft falls back to
// ['08:00'] in interval mode, which must not count as a change)
const sameSchedule = (a: AutoSyncSchedule, b: AutoSyncSchedule) =>
  a.mode === b.mode &&
  (a.mode === 'interval'
    ? a.interval_minutes === b.interval_minutes
    : normalizeSyncTimes(a.times).join(',') === normalizeSyncTimes(b.times).join(','));

const suggestNextTime = (times: string[]): string => {
  const sorted = normalizeSyncTimes(times);
  if (sorted.length === 0) return '08:00';
  const [h, m] = sorted[sorted.length - 1].split(':').map(Number);
  const next = `${String((h + 6) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return sorted.includes(next) ? `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` : next;
};

export const AutoSyncSettingsCard: React.FC = () => {
  const {
    t, autoSyncStatus, autoSyncEnabled, toggleAutoSync, updateAutoSyncSchedule, runSyncNow,
  } = useApp();
  const L = t.autoSync;

  const serverSchedule = scheduleFromStatus(autoSyncStatus);

  // Local draft (what the user is editing). Synced from server when not dirty.
  const [mode, setMode] = useState<AutoSyncMode>(serverSchedule.mode);
  const [intervalInput, setIntervalInput] = useState<string>(String(serverSchedule.interval_minutes));
  const [times, setTimes] = useState<string[]>(serverSchedule.times.length ? serverSchedule.times : ['08:00']);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const serverKey = `${serverSchedule.mode}|${serverSchedule.interval_minutes}|${serverSchedule.times.join(',')}`;

  useEffect(() => {
    if (dirty || saving) return;
    setMode(serverSchedule.mode);
    setIntervalInput(String(serverSchedule.interval_minutes));
    setTimes(serverSchedule.times.length ? serverSchedule.times : ['08:00']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const buildDraft = useCallback((): AutoSyncSchedule | null => {
    const interval = Math.round(Number(intervalInput));
    const normTimes = normalizeSyncTimes(times);
    if (mode === 'interval' && (!Number.isFinite(interval) || interval < 1)) return null;
    if (mode === 'times' && normTimes.length === 0) return null;
    return {
      mode,
      interval_minutes: Number.isFinite(interval) && interval >= 1 ? interval : serverSchedule.interval_minutes,
      times: mode === 'times' ? normTimes : serverSchedule.times,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, intervalInput, times, serverKey]);

  const applyingRef = useRef(false);
  const editSeqRef = useRef(0);
  const apply = useCallback(async () => {
    const draft = buildDraft();
    if (!draft) return;
    if (sameSchedule(draft, serverSchedule)) {
      setDirty(false);
      return;
    }
    if (applyingRef.current) return;
    applyingRef.current = true;
    const seqAtStart = editSeqRef.current;
    setSaving(true);
    const res = await updateAutoSyncSchedule(draft, { silent: true });
    applyingRef.current = false;
    setSaving(false);
    // Keep dirty if the save failed or the user edited again while the request was in flight
    // (the debounce effect re-arms when `saving` flips back to false)
    if (res && editSeqRef.current === seqAtStart) setDirty(false);
    if (res) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildDraft, serverKey, updateAutoSyncSchedule]);

  // Debounced apply: preset clicks / typing only send one request after the user pauses.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => applyRef.current(), APPLY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, mode, intervalInput, times]);

  const markDirty = () => {
    editSeqRef.current += 1;
    setDirty(true);
  };

  const handleToggle = async () => {
    setToggling(true);
    // Flush pending edits first so enabling uses the schedule the user sees
    if (dirty) await applyRef.current();
    await toggleAutoSync(!autoSyncEnabled);
    setToggling(false);
  };

  const handleRunNow = async () => {
    setTriggering(true);
    await runSyncNow();
    setTriggering(false);
  };

  const changeMode = (next: AutoSyncMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === 'times' && normalizeSyncTimes(times).length === 0) setTimes(['08:00']);
    markDirty();
  };

  const running = !!autoSyncStatus?.running;
  const lastResult = autoSyncStatus?.last_run_result;
  const draftInvalid = buildDraft() === null;
  const currentInterval = Number(intervalInput);

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
      {/* Header with Switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded-lg transition-colors shrink-0 ${
            autoSyncEnabled
              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          }`}>
            <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{L.title}</span>
              <span className={`text-[10px] font-bold px-1.5 rounded uppercase ${
                autoSyncEnabled
                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {autoSyncEnabled ? L.on : L.off}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{L.description}</p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={autoSyncEnabled}
          disabled={toggling || autoSyncStatus === null}
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 disabled:opacity-60 ${
            autoSyncEnabled
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'
          }`}
        >
          {toggling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {autoSyncEnabled ? L.enabledButton : L.disabledButton}
        </button>
      </div>

      {/* Mode switch */}
      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div role="tablist" className="inline-flex p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700">
            {([
              { value: 'interval' as AutoSyncMode, label: L.modeInterval, Icon: Timer },
              { value: 'times' as AutoSyncMode, label: L.modeTimes, Icon: CalendarClock },
            ]).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => changeMode(value)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  mode === value
                    ? 'bg-white dark:bg-slate-700 text-primary-700 dark:text-primary-300 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <span className="text-[10px] font-semibold min-h-[16px] flex items-center gap-1">
            {saving ? (
              <span className="flex items-center gap-1 text-slate-400"><Loader2 className="w-3 h-3 animate-spin" />{L.saving}</span>
            ) : savedFlash ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="w-3 h-3" />{L.saved}</span>
            ) : dirty && draftInvalid ? (
              <span className="text-rose-500">{mode === 'interval' ? L.invalidInterval : L.invalidTimes}</span>
            ) : null}
          </span>
        </div>

        {mode === 'interval' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{L.intervalLabel}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="10080"
                  value={intervalInput}
                  onChange={(e) => {
                    setIntervalInput(e.target.value);
                    markDirty();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyRef.current();
                    }
                  }}
                  placeholder="10"
                  className="w-20 px-2.5 py-1 text-xs font-bold text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none"
                />
                <span className="text-xs text-slate-500 font-medium">{L.minutes}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1">{L.quickPick}</span>
              {PRESETS.map((p) => {
                const isSelected = currentInterval === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => {
                      setIntervalInput(String(p.value));
                      markDirty();
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                      isSelected
                        ? 'bg-primary-50 dark:bg-primary-950/80 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700 font-bold'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                <span>{L.timesLabel}</span>
              </div>
              <span className="text-[10px] text-slate-400">{L.timezoneNote}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {times.map((time, idx) => {
                const invalid = !isValidSyncTime(time);
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-lg border bg-white dark:bg-slate-800 ${
                      invalid ? 'border-rose-300 dark:border-rose-700' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTimes((prev) => prev.map((x, i) => (i === idx ? v : x)));
                        markDirty();
                      }}
                      className="w-[84px] text-xs font-bold bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none dark:[color-scheme:dark]"
                    />
                    <button
                      type="button"
                      title={L.removeTime}
                      aria-label={L.removeTime}
                      onClick={() => {
                        setTimes((prev) => prev.filter((_, i) => i !== idx));
                        markDirty();
                      }}
                      className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setTimes((prev) => [...prev, suggestNextTime(prev)]);
                  markDirty();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-dashed border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40"
              >
                <Plus className="w-3 h-3" />
                {L.addTime}
              </button>
            </div>
            {times.length === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">{L.noTimes}</p>}
          </div>
        )}
      </div>

      {/* Status & run now */}
      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 text-[11px] min-w-0">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 flex-wrap">
            <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="font-semibold">{L.lastRun}:</span>
            {running ? (
              <span className="flex items-center gap-1 text-primary-600 dark:text-primary-400 font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" />
                {L.running}
              </span>
            ) : (
              <span>{autoSyncStatus?.last_run_at ? formatDateTimeShort(autoSyncStatus.last_run_at) : L.never}</span>
            )}
          </div>
          {lastResult && !running && (
            <div className="flex items-center gap-1 flex-wrap pl-5">
              <span className="px-1.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-semibold">
                {L.resultVesselsOk}: {lastResult.vessels_ok ?? 0}
              </span>
              <span className={`px-1.5 rounded font-semibold ${
                (lastResult.vessels_not_found ?? 0) > 0
                  ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {L.resultVesselsNotFound}: {lastResult.vessels_not_found ?? 0}
              </span>
              <span className="px-1.5 rounded bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 font-semibold">
                {L.resultContainersOk}: {lastResult.containers_ok ?? 0}
              </span>
              <span className={`px-1.5 rounded font-semibold ${
                (lastResult.errors ?? 0) > 0
                  ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {L.resultErrors}: {lastResult.errors ?? 0}
              </span>
            </div>
          )}
          {autoSyncEnabled && (
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <CalendarClock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-semibold">{L.nextRun}:</span>
              <span>{autoSyncStatus?.next_run_at ? formatDateTimeShort(autoSyncStatus.next_run_at) : '—'}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleRunNow}
          disabled={running || triggering || autoSyncStatus === null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {running || triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {running ? L.running : L.runNow}
        </button>
      </div>

      {autoSyncEnabled && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">{L.backgroundNote}</p>
      )}
    </div>
  );
};
