/**
 * "Is there a newer release?" for builds that cannot auto-update (macOS: no Developer ID, so Squirrel.Mac refuses).
 * Reads the latest GitHub release; the UI then offers its download page.
 *
 * Pure apart from the injected fetch, so it is tested without Electron (see release_check.test.js).
 */
const LATEST_API = 'https://api.github.com/repos/NguyenNgocBaoITITIU19084/auto_read_pdf/releases/latest';
const MAX_NOTES = 2000;

/** "v2.10.0" / "2.9.0" -> [2, 10, 0]; null when it is not a version. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** True when `latest` is a strictly newer version than `current`. */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Release notes as plain text: electron-updater hands HTML (or a list of {note}), GitHub hands Markdown. */
function plainNotes(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) return plainNotes(notes.map((n) => plainNotes(n && n.note)).filter(Boolean).join('\n'));
  const plain = String(notes)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.length > MAX_NOTES ? `${plain.slice(0, MAX_NOTES)}…` : plain;
}

/** {version, notes, url} of the latest release when it is newer than `current`, else null. Throws on network errors. */
async function findNewerRelease(current, fetchImpl = fetch) {
  const res = await fetchImpl(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (release.draft || release.prerelease || !isNewer(version, current)) return null;
  return { version, notes: plainNotes(release.body), url: release.html_url };
}

module.exports = { findNewerRelease, isNewer, parseVersion, plainNotes, LATEST_API };
