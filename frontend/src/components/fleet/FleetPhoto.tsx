import React, { useRef, useState } from 'react';
import { ImagePlus, Trash2, Truck, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { fleetPhotoUrl } from '../../services/api';
import { tf } from '../../services/i18nFormat';

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

const AVATAR_TONES = [
  'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200',
];

/** 'Nguyễn Văn An' -> 'VA' (Vietnamese names: the given name is last). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const picked = words.length === 1 ? [words[0]] : words.slice(-2);
  return picked.map((w) => w[0]).join('').toUpperCase();
}

const toneOf = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};

/** Why a picked file can't be a photo (a translation key), or null when it is fine. */
export function photoProblem(file: File): 'notImage' | 'heic' | 'tooLarge' | null {
  const name = file.name.toLowerCase();
  if (file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/.test(name)) return 'heic';
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/.test(name)) return 'notImage';
  if (file.size > PHOTO_MAX_BYTES) return 'tooLarge';
  return null;
}

interface AvatarProps {
  photo: string | null | undefined;
  /** what the placeholder shows: a truck icon, or the person's initials */
  kind: 'vehicle' | 'driver';
  name: string;
  /** xs/sm/md are square (people); wide/wideSm are landscape (trucks) */
  size?: 'xs' | 'sm' | 'md' | 'wide' | 'wideSm';
  onClick?: () => void;
}

const SIZES = {
  xs: 'w-6 h-6 text-[9px]', sm: 'w-10 h-10 text-xs', md: 'w-12 h-12 text-sm', wide: 'w-[4.5rem] h-12 text-xs', wideSm: 'w-12 h-8 text-[10px]',
};

/** A truck's / driver's photo in a table, or a placeholder; with onClick it opens the photo. */
export const FleetAvatar: React.FC<AvatarProps> = ({ photo, kind, name, size = 'sm', onClick }) => {
  const { t } = useApp();
  const [broken, setBroken] = useState(false);
  const url = broken ? '' : fleetPhotoUrl(photo);
  const shape = kind === 'driver' ? 'rounded-full' : 'rounded-lg';
  const box = `${SIZES[size]} ${shape} shrink-0 overflow-hidden flex items-center justify-center font-bold`;
  const body = url ? (
    <img src={url} alt={name} loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" />
  ) : kind === 'vehicle' ? (
    <Truck className={size === 'xs' ? 'w-3 h-3' : size === 'wideSm' ? 'w-4 h-4' : 'w-5 h-5'} />
  ) : (
    initials(name)
  );
  const tone = url ? 'bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700'
    : kind === 'vehicle' ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500' : toneOf(name);
  if (url && onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={tf(t.fleet.photo.view, { name })} title={tf(t.fleet.photo.view, { name })}
        className={`${box} ${tone} cursor-zoom-in hover:ring-2 hover:ring-primary-400`}>
        {body}
      </button>
    );
  }
  return <span className={`${box} ${tone}`} aria-hidden={!url}>{body}</span>;
};

/** A stored photo full size, over everything; Escape or a click closes it. */
export const PhotoLightbox: React.FC<{ photo: string | null; name: string; onClose: () => void }> = ({ photo, name, onClose }) => {
  const { t } = useApp();
  React.useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, onClose]);
  if (!photo) return null;
  return (
    <div role="dialog" aria-label={name} className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 p-6 bg-slate-950/85"
      onClick={onClose}>
      <button type="button" onClick={onClose} aria-label={t.fleet.photo.close}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"><X className="w-5 h-5" /></button>
      <img src={fleetPhotoUrl(photo)} alt={name} className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()} />
      <div className="text-sm font-semibold text-white">{name}</div>
    </div>
  );
};

export interface PhotoChoice {
  /** a newly picked file, uploaded on save */
  file: File | null;
  /** the stored photo is to be removed on save */
  remove: boolean;
}

interface PickerProps {
  kind: 'vehicle' | 'driver';
  name: string;
  /** the photo stored now ('' = none) */
  current: string;
  value: PhotoChoice;
  onChange: (next: PhotoChoice) => void;
  onError: (message: string) => void;
}

/** Photo field of the truck / driver forms: preview, pick (click or drop), change, remove. Nothing is sent until the
 *  form is saved. */
export const PhotoPicker: React.FC<PickerProps> = ({ kind, name, current, value, onChange, onError }) => {
  const { t } = useApp();
  const p = t.fleet.photo;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = useObjectUrl(value.file);
  const shown = preview || (!value.remove && current ? fleetPhotoUrl(current) : '');

  const take = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      onError(p[problem]);
      return;
    }
    onError('');
    onChange({ file, remove: false });
  };

  const round = kind === 'driver' ? 'rounded-full' : 'rounded-xl';
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        aria-label={shown ? p.change : p.choose} title={p.drop}
        className={`relative w-24 h-24 shrink-0 overflow-hidden ${round} border-2 border-dashed flex items-center justify-center transition-colors ${
          over ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-primary-300'}`}>
        {shown ? <img src={shown} alt={name || p.label} className="w-full h-full object-cover" />
          : kind === 'vehicle' ? <Truck className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            : <span className="text-2xl font-bold text-slate-300 dark:text-slate-600">{name.trim() ? initials(name) : <ImagePlus className="w-8 h-8" />}</span>}
      </button>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <ImagePlus className="w-3.5 h-3.5" />{shown ? p.change : p.choose}
          </button>
          {shown && (
            <button type="button" onClick={() => onChange({ file: null, remove: !!current })}
              className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-semibold rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">
              <Trash2 className="w-3.5 h-3.5" />{p.remove}
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.drop}<br />{p.hint}</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" className="hidden"
        data-testid={`${kind}-photo-input`}
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
};
