/**
 * Clipboard helpers for pasting booking images / PDFs.
 */

const IMAGE_EXT = /\.(png|jpe?g|jfif|webp|bmp|gif|tiff?)$/i;

export const isImageFile = (f: File): boolean =>
  (f.type || '').toLowerCase().startsWith('image/') || IMAGE_EXT.test(f.name || '');

export const isPdfFile = (f: File): boolean =>
  (f.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(f.name || '');

const sniffType = (b: Uint8Array): string | null => {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  const ascii = (from: number, text: string) => [...text].every((c, i) => b[from + i] === c.charCodeAt(0));
  if (ascii(0, '%PDF')) return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'BM')) return 'image/bmp';
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  return null;
};

const readHead = (f: Blob, size: number): Promise<ArrayBuffer> => {
  const head = f.slice(0, size);
  if (typeof head.arrayBuffer === 'function') return head.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(head);
  });
};

/**
 * Tells a dropped / picked booking file apart by its first bytes, so a photo saved as ".pdf" or with no
 * extension is still read (with OCR) as a photo. Returns the file with a matching name and type, or null when
 * it is neither a PDF nor an image.
 */
export async function identifyBookingFile(f: File): Promise<File | null> {
  let type: string | null = null;
  try {
    type = sniffType(new Uint8Array(await readHead(f, 16)));
  } catch {
    /* unreadable: fall back to the name / type below */
  }
  if (!type) return isPdfFile(f) || isImageFile(f) ? f : null;
  const isPdf = type === 'application/pdf';
  if (isPdf ? isPdfFile(f) && !isImageFile(f) : isImageFile(f) && !isPdfFile(f)) return f;
  const ext = isPdf ? 'pdf' : EXT_BY_TYPE[type] || type.split('/')[1];
  const base = (f.name || 'booking').replace(/\.[^./\\]*$/, '');
  return new File([f], `${base}.${ext}`, { type, lastModified: f.lastModified });
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/tiff': 'tif',
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
