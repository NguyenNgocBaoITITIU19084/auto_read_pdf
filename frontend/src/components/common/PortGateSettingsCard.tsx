import React, { useEffect, useState } from 'react';
import { DoorOpen, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getPortGateHoursApi, PortGateHours, savePortGateHoursApi } from '../../services/api';

const PORT = 'ITC';
const CARGO = ['dry', 'reefer', 'haz'] as const;
type Cargo = typeof CARGO[number];
const MAX_HOURS = 720;

/** How many hours before the cut-off SP-ITC opens its gate, per cargo type (it publishes no opening time). */
export const PortGateSettingsCard: React.FC = () => {
  const { t, addToast } = useApp();
  const L = t.portGate;
  const [all, setAll] = useState<PortGateHours | null>(null);
  const [draft, setDraft] = useState<Record<Cargo, string>>({ dry: '', reefer: '', haz: '' });
  const [saving, setSaving] = useState(false);

  const fill = (hours: PortGateHours) => {
    setAll(hours);
    const h = hours[PORT];
    if (h) setDraft({ dry: String(h.dry), reefer: String(h.reefer), haz: String(h.haz) });
  };

  useEffect(() => {
    let alive = true;
    getPortGateHoursApi().then((h) => alive && fill(h)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const parsed = CARGO.map((c) => Number(draft[c]));
  const valid = parsed.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_HOURS);
  const saved = all?.[PORT];
  const dirty = !!saved && CARGO.some((c, i) => saved[c] !== parsed[i]);

  const save = async () => {
    if (!valid) {
      addToast(L.invalid, 'error');
      return;
    }
    setSaving(true);
    try {
      const [dry, reefer, haz] = parsed;
      fill(await savePortGateHoursApi({ ...(all || {}), [PORT]: { dry, reefer, haz } }));
      addToast(L.saved, 'success');
    } catch {
      addToast(t.common.error, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60">
      <div className="flex items-center gap-2 mb-1">
        <DoorOpen className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">{L.title}</h5>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{L.desc}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {CARGO.map((c, i) => (
          <label key={c} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {L[c]}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={MAX_HOURS}
                step={1}
                value={draft[c]}
                disabled={!saved}
                onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
                className="w-20 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
              />
              <span className="font-normal text-slate-500 dark:text-slate-400">
                {L.hours}
                {Number.isInteger(parsed[i]) && parsed[i] > 0 && parsed[i] % 24 === 0 ? ` (${parsed[i] / 24} ${L.days})` : ''}
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 text-white disabled:opacity-40 hover:bg-primary-700 transition-colors"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {L.save}
        </button>
      </div>
    </div>
  );
};
