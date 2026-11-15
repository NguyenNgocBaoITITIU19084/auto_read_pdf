import React, { useRef, useState } from 'react';
import { CreditCard, IdCard, ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { deleteFleetDriverDocumentApi, fleetPhotoUrl, uploadFleetDriverDocumentApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { DriverDocument, FleetDriver } from '../../types';
import { photoProblem } from './FleetPhoto';
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

interface CardProps {
  driver: FleetDriver;
  kind: 'license' | 'id';
  /** the card's facts (number, class, expiry), shown above its two sides */
  facts: React.ReactNode;
  onOpen: (photo: string, name: string) => void;
  onChanged: () => void;
}

/** A licence or CCCD: its facts and both sides. */
export const DriverPaperCard: React.FC<CardProps> = ({ driver, kind, facts, onOpen, onChanged }) => {
  const { t } = useApp();
  const D = t.fleet.detail;
  const doc = kind === 'license' ? D.license : D.idCard;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span className="p-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-300">
          {kind === 'license' ? <CreditCard className="w-4 h-4" /> : <IdCard className="w-4 h-4" />}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{doc}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{facts}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DocumentTile driver={driver} which={`${kind}_front`} doc={doc} side={D.front} onOpen={onOpen} onChanged={onChanged} />
        <DocumentTile driver={driver} which={`${kind}_back`} doc={doc} side={D.back} onOpen={onOpen} onChanged={onChanged} />
      </div>
    </div>
  );
};
