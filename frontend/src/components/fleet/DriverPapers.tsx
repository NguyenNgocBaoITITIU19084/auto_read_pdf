import React, { useRef, useState } from 'react';
import { Check, ClipboardCheck, Copy, CreditCard, FileText, IdCard, ImagePlus, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import {
  deleteFleetDriverDocumentApi, deleteFleetVehicleDocumentApi, fleetPhotoUrl, uploadFleetDriverDocumentApi, uploadFleetVehicleDocumentApi,
} from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { DriverDocument, FleetDriver, FleetVehicle, VehicleDocument } from '../../types';
import { copyTextToClipboard } from '../../utils/formatters';
import { photoProblem, type PhotoChoice } from './FleetPhoto';
import { apiError } from './fleetUtils';

/** The pieces the driver popups share (details, add, edit), so the three look the same: sections, the licence /
 *  CCCD rows, their fact boxes and their front / back image slots. */

// ---------------------------------------------------------------------------
// Section: an uppercase title (with an optional link at its right), then its content
// ---------------------------------------------------------------------------
export const DriverSection: React.FC<{ title: string; children: React.ReactNode; extra?: React.ReactNode }> = ({ title, children, extra }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
      {extra}
    </div>
    {children}
  </section>
);

// ---------------------------------------------------------------------------
// A paper's row: icon + title, then [its facts | front | back]. Every row uses the same columns, so the sides line up.
// ---------------------------------------------------------------------------
export type PaperKind = 'license' | 'id' | 'registration' | 'insurance' | 'ownership';

/** A paper's name, and its icon. */
export const usePaperTitle = () => {
  const { t } = useApp();
  const D = t.fleet.detail;
  return (kind: PaperKind) => ({ license: D.license, id: D.idCard, registration: D.inspection, insurance: D.insuranceDoc,
    ownership: D.ownership })[kind];
};
const PAPER_ICON: Record<PaperKind, React.ElementType> = {
  license: CreditCard, id: IdCard, registration: ClipboardCheck, insurance: ShieldCheck, ownership: FileText,
};

export const PaperRow: React.FC<{ kind: PaperKind; facts: React.ReactNode; front: React.ReactNode; back: React.ReactNode; hint?: string }> = ({
  kind, facts, front, back, hint,
}) => {
  const title = usePaperTitle();
  const Icon = PAPER_ICON[kind];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5" data-testid={`paper-${kind}`}>
      <div className="flex items-center gap-2">
        <span className="p-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-300">
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title(kind)}</span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-[14rem,1fr,1fr] items-start gap-3">
        <div className="col-span-2 sm:col-span-1 space-y-2">{facts}</div>
        {front}
        {back}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Fact boxes: the same box shows a value (details, with a copy button) or takes one (forms)
// ---------------------------------------------------------------------------
const BOX = 'block px-2.5 py-1.5 rounded-xl border';
const BOX_LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';

/** One fact of a paper (class, number, expiry). */
export interface PaperField {
  key: string;
  label: string;
  /** what the copy button copies ('' = nothing to copy, shown as "—") */
  value: string;
  /** what the box shows, when not just `value` (a date with its days-left badge) */
  display?: React.ReactNode;
}

/** A fact to read, with a copy button, like the booking details. */
export const FieldBox: React.FC<{ field: PaperField }> = ({ field }) => {
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
    <div data-testid={`paper-field-${field.key}`} className={`${BOX} ${empty
      ? 'bg-slate-50/40 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
      : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={BOX_LABEL}>{field.label}</span>
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

/** The same box, to type the fact in (the add / edit form). */
export const FieldInputBox: React.FC<{ label: string; required?: boolean; children: React.ReactElement }> = ({ label, required, children }) => (
  <label className={`${BOX} bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/30`}>
    <span className={BOX_LABEL}>{label}{required && <span className="text-rose-500"> *</span>}</span>
    {React.cloneElement(children, {
      className: 'block w-full bg-transparent p-0 border-0 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0',
    })}
  </label>
);

// ---------------------------------------------------------------------------
// Image slot: one side of a paper. The details save at once; the form keeps the choice until it is saved.
// ---------------------------------------------------------------------------
interface SlotProps {
  testId: string;
  /** what is shown now ('' = nothing: a drop zone) */
  image: string;
  alt: string;
  doc: string;
  side: string;
  busy?: boolean;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
  /** a click on the image opens it large (the details); without it a click picks another one (the form) */
  onView?: () => void;
}

const PaperSlot: React.FC<SlotProps> = ({ testId, image, alt, doc, side, busy, onPick, onRemove, onView }) => {
  const { t } = useApp();
  const D = t.fleet.detail;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const drop = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); onPick(e.dataTransfer.files?.[0]); },
  };
  const sideTag = (
    <span className="absolute top-2 left-2 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{side}</span>
  );
  return (
    // its own layer: the scan is not repainted each time a box elsewhere is picked or edited
    <div className="relative will-change-transform" data-testid={testId}>
      {image ? (
        <div className={`group relative aspect-[1.586] overflow-hidden rounded-xl ring-1 bg-slate-100 dark:bg-slate-800 ${over
          ? 'ring-2 ring-primary-500' : 'ring-slate-200 dark:ring-slate-700'}`} {...drop}>
          <button type="button" onClick={onView || pick}
            aria-label={onView ? tf(t.fleet.photo.view, { name: alt }) : `${D.changeImage} · ${doc} – ${side}`}
            className={`block w-full h-full ${onView ? 'cursor-zoom-in' : ''}`}>
            <img src={image} alt={alt} decoding="async" className="w-full h-full object-cover" />
          </button>
          {sideTag}
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1.5 bg-gradient-to-t from-slate-900/70 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={pick} title={D.changeImage} aria-label={`${D.changeImage} · ${doc} – ${side}`}
              className="p-1.5 rounded-md bg-white/90 text-slate-700 hover:bg-white"><RefreshCw className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={onRemove} title={D.removeImage} aria-label={`${D.removeImage} · ${doc} – ${side}`}
              className="p-1.5 rounded-md bg-white/90 text-rose-600 hover:bg-white"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={pick} {...drop} aria-label={`${D.addImage} · ${doc} – ${side}`}
          className={`relative flex w-full aspect-[1.586] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-xs transition-colors ${over
            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 hover:border-primary-300 hover:text-primary-600'}`}>
          {sideTag}
          <ImagePlus className="w-6 h-6" />
          <span className="font-semibold">{D.addImage}</span>
          <span className="text-[10px] opacity-80 px-2 text-center">{D.dropHint}</span>
        </button>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-white/70 dark:bg-slate-900/70 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" />{D.uploading}
        </div>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" className="hidden"
        data-testid={`${testId}-input`} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Details: a side saved and removed at once
// ---------------------------------------------------------------------------
type TileOwner = { kind: 'driver'; item: FleetDriver; which: DriverDocument } | { kind: 'vehicle'; item: FleetVehicle; which: VehicleDocument };
type TileProps = TileOwner & {
  doc: string;
  side: string;
  onOpen: (photo: string, name: string) => void;
  onChanged: () => void;
};

/** One side of a driver's or a truck's paper in its details: saved and removed at once. */
export const DocumentTile: React.FC<TileProps> = (props) => {
  const { doc, side, onOpen, onChanged } = props;
  const owner = props.kind === 'driver' ? props.item.name : props.item.plate;
  const which = props.which;
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const D = t.fleet.detail;
  const [busy, setBusy] = useState(false);
  const image = props.kind === 'driver' ? props.item[props.which] : props.item[props.which];
  const label = tf(D.imageName, { doc, side, name: owner });
  const save = (file: File) => (props.kind === 'driver' ? uploadFleetDriverDocumentApi(props.item.id, props.which, file)
    : uploadFleetVehicleDocumentApi(props.item.id, props.which, file));
  const drop = () => (props.kind === 'driver' ? deleteFleetDriverDocumentApi(props.item.id, props.which)
    : deleteFleetVehicleDocumentApi(props.item.id, props.which));

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      addToast(done, 'success');
      onChanged();
    } catch (err) {
      addToast(apiError(err, t.fleet.toast.error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      addToast(t.fleet.photo[problem], 'error');
      return;
    }
    void run(() => save(file), tf(D.saved, { doc, side }));
  };
  const remove = async () => {
    if (!(await confirm({ message: tf(D.removeConfirm, { doc, side, name: owner }), confirmText: D.removeImage, danger: true }))) return;
    void run(drop, tf(D.removed, { doc, side }));
  };

  return (
    <PaperSlot testId={`doc-${which}`} image={image ? fleetPhotoUrl(image) : ''} alt={label} doc={doc} side={side} busy={busy}
      onPick={upload} onRemove={() => void remove()} onView={() => onOpen(image, label)} />
  );
};

// ---------------------------------------------------------------------------
// Form: a side picked now, uploaded when the form is saved
// ---------------------------------------------------------------------------
export type PaperChoices = Record<DriverDocument, PhotoChoice>;
export const NO_PAPER_CHANGES: PaperChoices = {
  license_front: { file: null, remove: false }, license_back: { file: null, remove: false },
  id_front: { file: null, remove: false }, id_back: { file: null, remove: false },
};

interface PaperPickerProps {
  which: DriverDocument | VehicleDocument;
  doc: string;
  side: string;
  /** the scan stored now ('' = none) */
  current: string;
  value: PhotoChoice;
  onChange: (next: PhotoChoice) => void;
  onError: (message: string) => void;
}

export const PaperPicker: React.FC<PaperPickerProps> = ({ which, doc, side, current, value, onChange, onError }) => {
  const { t } = useApp();
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
    <PaperSlot testId={`paper-picker-${which}`} image={shown} alt={`${doc} – ${side}`} doc={doc} side={side}
      onPick={take} onRemove={() => onChange({ file: null, remove: !!current })} />
  );
};
