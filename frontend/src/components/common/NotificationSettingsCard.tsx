import React, { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NotificationKind, NotificationSettings } from '../../types';
import { getNotificationSettingsApi, saveNotificationSettingsApi, sendTestNotificationApi } from '../../services/api';
import { useNotifications } from '../../context/NotificationsContext';

/** The kinds a user can switch on / off (the test sample is not one of them) */
type SettingKind = Exclude<NotificationKind, 'test'>;

const CONTAINER_KINDS: SettingKind[] = ['container_customs', 'container_ingate', 'container_outgate'];
const VESSEL_KINDS: SettingKind[] = ['vessel_closing', 'vessel_closing_icd', 'vessel_open_gate', 'vessel_eta', 'vessel_etd'];

/** Which changes raise a notification (and whether the OS may pop them up). Saved as soon as it is changed. */
export const NotificationSettingsCard: React.FC = () => {
  const { t, addToast } = useApp();
  const s = t.notifications.settings;
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { refresh } = useNotifications();
  const desktop = typeof window !== 'undefined' && !!window.electronAPI?.platform;

  useEffect(() => {
    let alive = true;
    getNotificationSettingsApi().then((v) => alive && setSettings(v)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async (kinds: NotificationKind[], osEnabled: boolean) => {
    setSaving(true);
    try {
      setSettings(await saveNotificationSettingsApi(kinds, osEnabled));
    } catch {
      addToast(s.saveFailed, 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await sendTestNotificationApi();
      await refresh();                                            // the bell shows it right away
      await window.electronAPI?.pollNotificationsNow?.().catch(() => {});   // desktop: pop it up now
      addToast(s.testDone, 'success');
    } catch {
      addToast(s.testFailed, 'error');
    } finally {
      setTesting(false);
    }
  };

  const toggleKind = (kind: SettingKind) => {
    if (!settings) return;
    const kinds = settings.kinds.includes(kind) ? settings.kinds.filter((k) => k !== kind) : [...settings.kinds, kind];
    void save(kinds, settings.os_enabled);
  };

  const group = (title: string, kinds: SettingKind[]) => (
    <fieldset className="space-y-1.5">
      <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">{title}</legend>
      {kinds.map((kind) => (
        <label key={kind} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={!!settings?.kinds.includes(kind)}
            disabled={!settings || saving}
            onChange={() => toggleKind(kind)}
            className="rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
          />
          {t.notifications.kinds[kind]}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 shrink-0">
          <BellRing className="w-4 h-4" />
        </div>
        <div>
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{s.title}</span>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{s.desc}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {group(s.groupContainer, CONTAINER_KINDS)}
        {group(s.groupVessel, VESSEL_KINDS)}
      </div>

      <label className={`flex items-start gap-2 text-xs ${desktop ? 'text-slate-700 dark:text-slate-200 cursor-pointer' : 'text-slate-400 dark:text-slate-500'}`}>
        <input
          type="checkbox"
          checked={!!settings?.os_enabled && desktop}
          disabled={!settings || saving || !desktop}
          onChange={() => settings && void save(settings.kinds, !settings.os_enabled)}
          className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
        />
        <span>
          {s.os}
          {!desktop && <span className="block text-[11px] italic">{s.osBrowser}</span>}
        </span>
      </label>

      <div className="flex items-start justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{s.requirement}</p>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white whitespace-nowrap shrink-0"
        >
          <BellRing className="w-3.5 h-3.5" />
          {s.test}
        </button>
      </div>
    </div>
  );
};
