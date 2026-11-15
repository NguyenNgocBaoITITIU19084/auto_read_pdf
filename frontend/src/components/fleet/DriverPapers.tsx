import React, { useRef, useState } from 'react';
import { Check, Copy, CreditCard, IdCard, ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { deleteFleetDriverDocumentApi, fleetPhotoUrl, uploadFleetDriverDocumentApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { DriverDocument, FleetDriver } from '../../types';
import { photoProblem, type PhotoChoice } from './FleetPhoto';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { copyTextToClipboard } from '../../utils/formatters';
import { apiError } from './fleetUtils';

interface TileProps {
  driver: FleetDriver;
  which: DriverDocument;
  doc: string;
  side: string;
  onOpen: (photo: string, name: string) => void;
  onChanged: () => void;
}

/** One side of a card (licence / CCCD): the scan, or a drop zone. Uploads and removes at once. */
const DocumentTile: React.FC<TileProps> = ({ driver, which, doc, side, onOpen, onChanged }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const D = t.fleet.detail;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const image = driver[which];
  const label = tf(D.imageName, { doc, side, name: driver.name });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      addToast(t.fleet.photo[problem], 'error');
      return;
    }
    setBusy(true);
    try {
      await uploadFleetDriverDocumentApi(driver.id, which, file);
      addToast(tf(D.saved, { doc, side }), 'success');
      onChanged();
    } catch (err) {
      addToast(apiError(err, t.fleet.toast.error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ message: tf(D.removeConfirm, { doc, side, name: driver.name }), confirmText: D.removeImage, danger: true }))) return;
    setBusy(true);
    try {
      await deleteFleetDriverDocumentApi(driver.id, which);
      addToast(tf(D.removed, { doc, side }), 'success');
      onChanged();
    } catch (err) {
      addToast(apiError(err, t.fleet.toast.error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const drop = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files?.[0]); },
  };
  const sideTag = (
    <span className="absolute top-2 left-2 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{side}</span>
  );

  return (
    <div className="relative" data-testid={`doc-${which}`}>
      {image ? (
        <div className={`group relative aspect-[1.586] overflow-hidden rounded-xl ring-1 bg-slate-100 dark:bg-slate-800 ${over
          ? 'ring-2 ring-primary-500' : 'ring-slate-200 dark:ring-slate-700'}`} {...drop}>
          <button type="button" onClick={() => onOpen(image, label)} aria-label={tf(t.fleet.photo.view, { name: label })}
            className="block w-full h-full cursor-zoom-in">
            <img src={fleetPhotoUrl(image)} alt={label} className="w-full h-full object-cover" />
          </button>
          {sideTag}
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1.5 bg-gradient-to-t from-slate-900/70 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={() => input.current?.click()} title={D.changeImage} aria-label={`${D.changeImage} · ${doc} – ${side}`}
              className="p-1.5 rounded-md bg-white/90 text-slate-700 hover:bg-white"><RefreshCw className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => void remove()} title={D.removeImage} aria-label={`${D.removeImage} · ${doc} – ${side}`}
              className="p-1.5 rounded-md bg-white/90 text-rose-600 hover:bg-white"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} {...drop} aria-label={`${D.addImage} · ${doc} – ${side}`}
          className={`relative flex w-full aspect-[1.586] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-xs transition-colors ${over
            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 hover:border-primary-300 hover:text-primary-600'}`}>
          {sideTag}
          <ImagePlus className="w-6 h-6" />
          <span className="font-semibold">{D.addImage}</span>
          <span className="text-[10px] opacity-80">{D.dropHint}</span>
        </button>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-white/70 dark:bg-slate-900/70 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" />{D.uploading}
        </div>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" className="hidden"
        data-testid={`doc-${which}-input`} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
};

/** One fact of a paper (class, number, expiry): a box with its label and a copy button, like the booking details. */
export interface PaperField {
  key: string;
  label: string;
  /** what the copy button copies ('' = nothing to copy, shown as "—") */
  value: string;
  /** what the box shows, when not just `value` (a date with its days-left badge) */
  display?: React.ReactNode;
}

const FieldBox: React.FC<{ field: PaperField }> = ({ field }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const [copied, setCopied] = useState(false);
  const empty = !field.value.trim();
  const copy = async () => {
    const ok = await copyTextToClipboard(field.value);
    addToast(ok ? t.common.copySuccess : t.fleet.toast.error, ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div data-testid={`paper-field-${field.key}`} className={`px-2.5 py-1.5 rounded-xl border ${empty
      ? 'bg-slate-50/40 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
      : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{field.label}</span>
        {!empty && (
          <button type="button" onClick={() => void copy()} title={t.common.copy} aria-label={`${t.common.copy} ${field.label}`}
            className="p-0.5 rounded text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${empty ? 'text-slate-400 font-normal' : 'text-slate-800 dark:text-slate-100'}`}>
        {empty ? t.fleet.none : field.display ?? field.value}
      </div>
    </div>
  );
};

interface CardProps {
  driver: FleetDriver;
  kind: 'license' | 'id';
  /** the paper's facts, each in its own copyable box, left of its two sides */
  fields: PaperField[];
  onOpen: (photo: string, name: string) => void;
  onChanged: () => void;
}

/** A licence or CCCD on one row: its title, then its facts and both sides. Rows share their columns, so the sides
 *  line up. */
export const DriverPaperCard: React.FC<CardProps> = ({ driver, kind, fields, onOpen, onChanged }) => {
  const { t } = useApp();
  const D = t.fleet.detail;
  const doc = kind === 'license' ? D.license : D.idCard;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5" data-testid={`paper-${kind}`}>
      <div className="flex items-center gap-2">
        <span className="p-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-300">
          {kind === 'license' ? <CreditCard className="w-4 h-4" /> : <IdCard className="w-4 h-4" />}
        </span>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{doc}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-[14rem,1fr,1fr] items-start gap-3">
        <div className="col-span-2 sm:col-span-1 space-y-2">
          {fields.map((field) => <FieldBox key={field.key} field={field} />)}
        </div>
        <DocumentTile driver={driver} which={`${kind}_front`} doc={doc} side={D.front} onOpen={onOpen} onChanged={onChanged} />
        <DocumentTile driver={driver} which={`${kind}_back`} doc={doc} side={D.back} onOpen={onOpen} onChanged={onChanged} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The driver form's scans: picked now, uploaded when the form is saved
// ---------------------------------------------------------------------------
export type PaperChoices = Record<DriverDocument, PhotoChoice>;
export const NO_PAPER_CHANGES: PaperChoices = {
  license_front: { file: null, remove: false }, license_back: { file: null, remove: false },
  id_front: { file: null, remove: false }, id_back: { file: null, remove: false },
};

interface PaperPickerProps {
  which: DriverDocument;
  doc: string;
  side: string;
  /** the scan stored now ('' = none) */
  current: string;
  value: PhotoChoice;
  onChange: (next: PhotoChoice) => void;
  onError: (message: string) => void;
}

/** One side of a licence / CCCD in the driver form: preview, pick (click or drop), change, remove. */
export const PaperPicker: React.FC<PaperPickerProps> = ({ which, doc, side, current, value, onChange, onError }) => {
  const { t } = useApp();
  const D = t.fleet.detail;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = useObjectUrl(value.file);
  const shown = preview || (!value.remove && current ? fleetPhotoUrl(current) : '');

  const take = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      onError(t.fleet.photo[problem]);
      return;
    }
    onError('');
    onChange({ file, remove: false });
  };

  return (
    <div className="relative" data-testid={`paper-picker-${which}`}>
      <button type="button" onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        aria-label={`${shown ? D.changeImage : D.addImage} · ${doc} – ${side}`} title={D.dropHint}
        className={`relative flex w-full aspect-[1.586] items-center justify-center overflow-hidden rounded-lg border-2 transition-colors ${
          shown ? 'border-transparent ring-1 ring-slate-200 dark:ring-slate-700' : 'border-dashed'} ${over
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-primary-300'}`}>
        {shown ? <img src={shown} alt={`${doc} – ${side}`} className="w-full h-full object-cover" />
          : <span className="flex flex-col items-center gap-1 text-[11px] font-semibold text-slate-400"><ImagePlus className="w-5 h-5" />{D.addImage}</span>}
        <span className="absolute top-1.5 left-1.5 rounded bg-slate-900/70 px-1 py-px text-[10px] font-semibold text-white">{side}</span>
      </button>
      {shown && (
        <button type="button" onClick={() => onChange({ file: null, remove: !!current })} title={D.removeImage}
          aria-label={`${D.removeImage} · ${doc} – ${side}`}
          className="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/90 text-rose-600 hover:bg-white shadow-sm"><Trash2 className="w-3 h-3" /></button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" className="hidden"
        data-testid={`paper-picker-${which}-input`} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
};
