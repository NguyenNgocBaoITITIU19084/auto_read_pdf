/**
 * Clipboard helpers for pasting booking images / PDFs.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i;

export const isImageFile = (f: File): boolean =>
  (f.type || '').toLowerCase().startsWith('image/') || IMAGE_EXT.test(f.name || '');

export const isPdfFile = (f: File): boolean =>
  (f.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(f.name || '');

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
};

/** Gives generic clipboard names ("image.png", "") a unique, descriptive filename. */
const withPastedName = (f: File): File => {
  const generic = !f.name || /^image\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name);
  if (!generic || !isImageFile(f)) return f;
  const ext = EXT_BY_TYPE[(f.type || '').toLowerCase()] || 'png';
  return new File([f], `pasted_booking_${Date.now()}.${ext}`, { type: f.type || 'image/png' });
};

/**
 * Collects files from a paste event. Reads `items` (kind "file") first and falls back to / merges
 * `files`, de-duplicated by name+size+type (Chromium exposes the same file through both).
 */
export function extractClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (f: File | null) => {
    if (!f) return;
    const key = `${f.name}|${f.size}|${f.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') push(items[i].getAsFile());
    }
  }
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) push(files[i]);
  }
  return out.map(withPastedName);
}

/** True when the element accepts typed text (input/textarea/contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const field = el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') as HTMLElement | null;
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    const nonText = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'];
    return !nonText.includes((field.type || '').toLowerCase());
  }
  return true;
}

export function dataUrlToFile(dataUrl: string, filename?: string): File | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  const mime = match[1] || 'image/png';
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    if (match[2]) {
      const bin = atob(match[3]);
      bytes = new Uint8Array(new ArrayBuffer(bin.length));
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      const encoded = new TextEncoder().encode(decodeURIComponent(match[3]));
      bytes = new Uint8Array(new ArrayBuffer(encoded.length));
      bytes.set(encoded);
    }
    if (bytes.length === 0) return null;
    const ext = EXT_BY_TYPE[mime.toLowerCase()] || 'png';
    return new File([bytes], filename || `pasted_booking_${Date.now()}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

/**
 * Reads an image from the system clipboard (button-triggered, no paste event).
 * Electron preload bridge first, then the async Clipboard API. Returns null when no image is present.
 * Throws only when the Clipboard API is unavailable/denied and Electron is absent.
 */
export async function readClipboardImageFile(): Promise<File | null> {
  const bridge = window.electronAPI?.readClipboardImage;
  if (typeof bridge === 'function') {
    try {
      const dataUrl = await bridge();
      if (dataUrl) {
        const file = dataUrlToFile(dataUrl);
        if (file) return file;
      }
    } catch (e) {
      console.warn('electronAPI.readClipboardImage failed, trying navigator.clipboard', e);
    }
  }

  const clip = navigator.clipboard as Clipboard | undefined;
  if (!clip || typeof clip.read !== 'function') {
    if (typeof bridge === 'function') return null;
    throw new Error('Clipboard API unavailable');
  }
  const items = await clip.read();
  for (const item of items) {
    const type = item.types.find((t) => t.toLowerCase().startsWith('image/'));
    if (type) {
      const blob = await item.getType(type);
      const ext = EXT_BY_TYPE[type.toLowerCase()] || 'png';
      return new File([blob], `pasted_booking_${Date.now()}.${ext}`, { type });
    }
  }
  return null;
}
