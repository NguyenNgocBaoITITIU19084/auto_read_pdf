import React, { useCallback, useEffect, useState } from 'react';
import {
  FolderInput, FolderOpen, Loader2, Play, RotateCcw, Timer, CalendarClock, Plus, X, Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AutoImportFile, AutoImportSchedule, AutoImportSettings, AutoImportStatus, AutoSyncMode } from '../../types';
import {
  forgetAutoImportFileApi, getAutoImportHistoryApi, getAutoImportSettingsApi, runAutoImportNowApi, saveAutoImportSettingsApi,
} from '../../services/api';
import { formatDateTimeShort } from '../../services/i18nFormat';
import { Switch } from './Switch';
import { isValidSyncTime, normalizeSyncTimes } from '../../services/autoSync';

const HISTORY_SHOWN = 8;
const MAX_INTERVAL_MINUTES = 1440;
// Scanning less often keeps the app quieter; "Quét ngay" still reads the folder at once
const INTERVAL_PRESETS = [
  { label: '1p', value: 1 },
  { label: '5p', value: 5 },
  { label: '15p', value: 15 },
  { label: '30p', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
];

const sameSchedule = (a: AutoImportSchedule, b: AutoImportSchedule) =>
  a.mode === b.mode &&
  (a.mode === 'interval'
    ? a.interval_minutes === b.interval_minutes
    : normalizeSyncTimes(a.times).join(',') === normalizeSyncTimes(b.times).join(','));

const STATUS: Record<AutoImportStatus, { label: string; tone: string }> = {
  imported: { label: 'Đã thêm', tone: 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300' },
  duplicate: { label: 'Trùng BK', tone: 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300' },
  no_data: { label: 'Cần nhập tay', tone: 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300' },
  error: { label: 'Lỗi', tone: 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300' },
};

const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

/** Settings panel: booking PDFs saved into a watched folder are read every minute and added to a collection. */
export const AutoImportSettingsCard: React.FC = () => {
  const { collections, activeCollection, addToast } = useApp();
  const [settings, setSettings] = useState<AutoImportSettings | null>(null);
  const [history, setHistory] = useState<AutoImportFile[]>([]);
  const [folder, setFolder] = useState('');
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [importExisting, setImportExisting] = useState(false);
  const [mode, setMode] = useState<AutoSyncMode>('interval');
  const [intervalInput, setIntervalInput] = useState('5');
  const [times, setTimes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const canPick = typeof window !== 'undefined' && !!window.electronAPI?.selectFolder;

  const applyServer = (s: AutoImportSettings) => {
    setSettings(s);
    setFolder(s.folder);
    setCollectionId(s.collection_ok ? s.collection_id : null);
    setMode(s.mode);
    setIntervalInput(String(s.interval_minutes));
    setTimes(s.times);
  };

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getAutoImportHistoryApi(HISTORY_SHOWN));
    } catch {
      /* only a hint */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getAutoImportSettingsApi().then((s) => alive && applyServer(s)).catch(() => {});
    void loadHistory();
    return () => { alive = false; };
  }, [loadHistory]);

  const targetId = collectionId ?? activeCollection?.id ?? null;
  const enabled = !!settings?.enabled;
  const folderChanged = !!settings && folder.trim() !== settings.folder;
  const intervalValue = Number(intervalInput);
  const schedule: AutoImportSchedule = { mode, interval_minutes: intervalValue, times: normalizeSyncTimes(times) };
  const scheduleError = mode === 'interval'
    ? (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > MAX_INTERVAL_MINUTES
      ? `Chu kỳ phải từ 1 đến ${MAX_INTERVAL_MINUTES} phút` : '')
    : (!times.length || times.some((x) => !isValidSyncTime(x)) ? 'Cần ít nhất một giờ quét hợp lệ' : '');
  const scheduleChanged = !!settings && !sameSchedule(schedule, settings);
  const dirty = !!settings && (folderChanged || targetId !== settings.collection_id || scheduleChanged);
  // The PDFs already there are only a question when the import starts watching a folder
  const startsWatching = !enabled || folderChanged;

  const save = async (nextEnabled: boolean) => {
    setSaving(true);
    try {
      const s = await saveAutoImportSettingsApi(nextEnabled, folder, targetId, startsWatching && importExisting,
        scheduleError ? undefined : schedule);
      applyServer(s);
      setImportExisting(false);
      addToast(nextEnabled ? 'Đã bật tự nhập PDF từ thư mục' : 'Đã tắt tự nhập PDF', 'success');
    } catch (e) {
      addToast(errorText(e, 'Không lưu được cài đặt tự nhập'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickFolder = async () => {
    const picked = await window.electronAPI?.selectFolder?.(folder || undefined).catch(() => null);
    if (picked) setFolder(picked);
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await runAutoImportNowApi();
      setSettings(r.settings);
      if (r.status === 'error') addToast(r.message, 'error');
      else if (r.status === 'busy') addToast('Đang quét thư mục, vui lòng thử lại sau ít giây', 'info');
      else if (!r.imported.length && !r.skipped.length) {
        addToast(r.waiting ? `Không có file mới (${r.waiting} file đang ghi dở, sẽ đọc ở lần quét sau)` : 'Không có file PDF mới', 'info');
      } else if (!r.imported.length) {
        addToast(`${r.skipped.length} file PDF cần xem lại`, 'info');
      } else {
        addToast(`Đã thêm ${r.imported.length} booking${r.skipped.length ? `, ${r.skipped.length} file cần xem lại` : ''}`,
          r.skipped.length ? 'info' : 'success');
      }
      await loadHistory();
    } catch (e) {
      addToast(errorText(e, 'Không quét được thư mục'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const retry = async (file: AutoImportFile) => {
    try {
      await forgetAutoImportFileApi(file.sha256);
      addToast(`"${file.file_name}" sẽ được đọc lại ở lần quét tới`, 'info');
      await loadHistory();
    } catch (e) {
      addToast(errorText(e, 'Không thực hiện được'), 'error');
    }
  };

  const discard = () => {
    if (settings) applyServer(settings);
    setImportExisting(false);
  };

  const last = settings?.last_result;
  const problem = enabled && settings
    ? (!settings.folder_ok ? 'Không tìm thấy thư mục theo dõi' : !settings.collection_ok ? 'Bộ sưu tập nhận booking không còn, vui lòng chọn lại' : '')
    : '';
  // What is still missing before the import can be switched on (shown instead of a silently disabled switch)
  const missing = !folder.trim() ? 'Chọn thư mục theo dõi bên dưới để bật'
    : !targetId ? 'Chọn bộ sưu tập nhận booking để bật'
    : scheduleError ? `${scheduleError} để bật` : '';
  const savedCollection = collections.find((c) => c.id === settings?.collection_id)?.name;
  const status: { tone: string; dot: string; text: React.ReactNode } = !settings
    ? { tone: 'bg-slate-100 dark:bg-slate-900/60 text-slate-500', dot: 'bg-slate-300', text: 'Đang tải…' }
    : problem
    ? { tone: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300', dot: 'bg-rose-500', text: <>Đã dừng: {problem}</> }
    : enabled
    ? {
        tone: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
        dot: 'bg-emerald-500 animate-pulse',
        text: (
          <>
            Đang theo dõi <b className="font-mono" title={settings.folder}>{folderName(settings.folder)}</b>
            {savedCollection ? <> → <b>{savedCollection}</b></> : null}
            {settings.next_scan_at ? <> · quét tới lúc {formatDateTimeShort(settings.next_scan_at)}</> : null}
          </>
        ),
      }
    : missing
    ? { tone: 'bg-slate-100 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400', text: <>Đang tắt · {missing}</> }
    : { tone: 'bg-slate-100 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400', text: 'Đang tắt · Bật công tắc để bắt đầu theo dõi thư mục' };

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3" data-testid="auto-import-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded-lg transition-colors shrink-0 ${
            enabled
              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          }`}>
            <FolderInput className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Tự nhập PDF từ thư mục</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Lưu PDF booking vào thư mục này, app tự đọc theo lịch quét bên dưới khi đang mở. File gốc được giữ nguyên.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          busy={saving}
          label="Tự nhập PDF từ thư mục"
          disabled={!settings || saving || (!enabled && !!missing)}
          onChange={() => save(!enabled)}
        />
      </div>

      <div role="status" className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${status.tone}`} data-testid="auto-import-status">
        <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />
        <span className="min-w-0 truncate">{status.text}</span>
      </div>

      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Thư mục theo dõi
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder={canPick ? 'Bấm "Chọn" để chọn thư mục' : 'Đường dẫn thư mục, ví dụ C:\\Booking'}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {canPick && (
              <button
                type="button"
                onClick={pickFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Chọn
              </button>
            )}
          </div>
        </label>

        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Thêm booking vào bộ sưu tập
          <select
            value={targetId ?? ''}
            onChange={(e) => setCollectionId(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="space-y-2" data-testid="auto-import-schedule">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Lịch quét thư mục</span>
            <div role="tablist" aria-label="Lịch quét thư mục" className="inline-flex p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700">
              {([
                { value: 'interval' as AutoSyncMode, label: 'Theo chu kỳ', Icon: Timer },
                { value: 'times' as AutoSyncMode, label: 'Giờ cố định', Icon: CalendarClock },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => {
                    setMode(value);
                    if (value === 'times' && !times.length) setTimes(['08:00', '13:30']);
                  }}
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
          </div>

          {mode === 'interval' ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Quét mỗi</span>
              <input
                type="number"
                min="1"
                max={MAX_INTERVAL_MINUTES}
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                aria-label="Chu kỳ quét (phút)"
                className="w-16 px-2 py-1 text-xs font-bold text-center bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">phút</span>
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setIntervalInput(String(p.value))}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                    intervalValue === p.value
                      ? 'bg-primary-50 dark:bg-primary-950/80 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700 font-bold'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {times.map((time, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-lg border bg-white dark:bg-slate-800 ${
                    isValidSyncTime(time) ? 'border-slate-300 dark:border-slate-600' : 'border-rose-300 dark:border-rose-700'
                  }`}
                >
                  <input
                    type="time"
                    value={time}
                    aria-label={`Giờ quét ${idx + 1}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTimes((prev) => prev.map((x, i) => (i === idx ? v : x)));
                    }}
                    className="w-[84px] text-xs font-bold bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none dark:[color-scheme:dark]"
                  />
                  <button
                    type="button"
                    aria-label={`Bỏ giờ ${time}`}
                    title="Bỏ giờ này"
                    onClick={() => setTimes((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setTimes((prev) => [...prev, '17:00'])}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-dashed border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40"
              >
                <Plus className="w-3 h-3" /> Thêm giờ
              </button>
              <span className="text-[10px] text-slate-400">Giờ Việt Nam</span>
            </div>
          )}
          <p className={`text-[11px] ${scheduleError ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {scheduleError || 'Quét thưa hơn giúp máy nhẹ hơn. Cần đọc liền thì bấm "Quét ngay".'}
          </p>
        </div>

        {startsWatching && (
          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={importExisting}
              onChange={(e) => setImportExisting(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
            />
            <span>Nhập luôn các PDF đang có sẵn trong thư mục (mặc định chỉ đọc file mới thêm vào)</span>
          </label>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Booking No đã có trong bộ sưu tập sẽ được bỏ qua và báo lại. PDF scan (không có lớp chữ) không được gửi đi đọc tự động, cần nhập tay.
        </p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 min-w-0">
            {settings?.last_scan_at ? (
              <span>
                Quét lần cuối {formatDateTimeShort(settings.last_scan_at)}
                {last && last.status === 'ok' && (last.imported || last.skipped) ? ` · thêm ${last.imported}, cần xem lại ${last.skipped}` : ''}
                {last && last.status === 'error' ? ` · ${last.message}` : ''}
              </span>
            ) : null}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={runNow}
              disabled={running || !settings?.folder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Quét ngay
            </button>
          </div>
        </div>
      </div>

      {enabled && dirty && (
        <div className="flex items-center justify-between gap-2 flex-wrap px-2.5 py-2 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30" data-testid="auto-import-unsaved">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
            <Info className="w-3.5 h-3.5" /> Có thay đổi chưa áp dụng, app vẫn đang chạy theo cài đặt cũ
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Hoàn tác
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving || !!missing}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white shadow-xs"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Lưu thay đổi
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">File đã xử lý gần đây</div>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.sha256} className="flex items-center gap-2 text-[11px]">
                <span className={`px-1.5 py-0.5 rounded font-bold shrink-0 ${STATUS[h.status]?.tone || ''}`}>{STATUS[h.status]?.label || h.status}</span>
                {h.booking_no && <span className="font-mono font-bold text-slate-800 dark:text-slate-100 shrink-0">{h.booking_no}</span>}
                <span className="truncate text-slate-600 dark:text-slate-300 min-w-0 flex-1" title={h.message ? `${h.file_name} · ${h.message}` : h.file_name}>
                  {h.file_name}
                </span>
                {h.status !== 'imported' && (
                  <button
                    type="button"
                    onClick={() => retry(h)}
                    title="Đọc lại file này ở lần quét tới"
                    aria-label={`Đọc lại ${h.file_name}`}
                    className="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
