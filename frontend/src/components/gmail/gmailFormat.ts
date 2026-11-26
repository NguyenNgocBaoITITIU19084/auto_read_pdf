/** Display helpers for Gmail addresses and snippets. */

export interface ParsedAddress {
  name: string;
  email: string;
}

/** `"LUCKY STAR" <a@b.com>` → { name: 'LUCKY STAR', email: 'a@b.com' }; a bare address has no name. */
export function parseAddress(raw: string): ParsedAddress {
  const text = (raw || '').trim();
  const m = text.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return { name: '', email: text };
  const name = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
  return { name, email: m[2].trim() };
}

/** The name if there is one, else the part of the address before "@". */
export function shortName(raw: string): string {
  const { name, email } = parseAddress(raw);
  return name || email.split('@')[0] || email;
}

/** Split "A <a@x>, \"B, Co\" <b@x>, c@x" into its addresses (commas inside quotes or <> do not split). */
export function splitAddresses(list: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of list || '') {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "LUCKY STAR <x@gmail.com>, Mail Delivery Subsystem <…>" → "LUCKY STAR, Mail Delivery Subsystem". */
export function participantNames(list: string): string {
  return splitAddresses(list).map(shortName).join(', ');
}

/** Gmail snippets arrive HTML-escaped ("Here&#39;s"); turn the entities back into text. */
export function decodeEntities(text: string): string {
  if (!text || !text.includes('&')) return text;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${text}`, 'text/html');
  return doc.body.textContent || '';
}

/** "05:10 · 25/11/2026" in Vietnamese format. */
export function formatFullDate(iso: string, ms: number): string {
  const d = iso ? new Date(iso) : ms ? new Date(ms) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${time} · ${date}`;
}

interface CidAttachment {
  id: number | string;
  content_id?: string;
}

function cidKey(cid: string): string {
  return cid.trim().replace(/^<|>$/g, '').toLowerCase();
}

/** Content-IDs that the HTML body references with src="cid:…". */
export function referencedCids(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of (html || '').matchAll(/cid:([^"'\s)>]+)/gi)) {
    try {
      out.add(cidKey(decodeURIComponent(m[1])));
    } catch {
      out.add(cidKey(m[1]));
    }
  }
  return out;
}

/** Point every cid: image at the attachment that carries that Content-ID. */
export function resolveCidImages<T extends CidAttachment>(
  html: string,
  attachments: T[],
  urlFor: (att: T) => string
): string {
  if (!html || !/cid:/i.test(html)) return html;
  const byCid = new Map<string, T>();
  attachments.forEach((a) => {
    if (a.content_id) byCid.set(cidKey(a.content_id), a);
  });
  return html.replace(/cid:([^"'\s)>]+)/gi, (whole, raw: string) => {
    let key = cidKey(raw);
    try {
      key = cidKey(decodeURIComponent(raw));
    } catch {
      /* keep raw */
    }
    const att = byCid.get(key);
    return att ? urlFor(att) : whole;
  });
}

/** Attachments worth a chip: images already shown inside the HTML body are left out. */
export function visibleAttachments<T extends CidAttachment>(attachments: T[], html: string): T[] {
  const cids = referencedCids(html);
  if (cids.size === 0) return attachments;
  return attachments.filter((a) => !(a.content_id && cids.has(cidKey(a.content_id))));
}
