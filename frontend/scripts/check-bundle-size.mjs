// Sums the JS the app loads at startup: the entry chunk plus its static imports (not dynamic imports).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT_BYTES = 300 * 1024;
const dist = new URL('../dist/', import.meta.url).pathname;
const manifestPath = join(dist, '.vite/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = Object.values(manifest).find((c) => c.isEntry);
const seen = new Set();
const visit = (key) => {
  if (!key || seen.has(key)) return;
  seen.add(key);
  (manifest[key].imports || []).forEach(visit);
};
visit(Object.keys(manifest).find((k) => manifest[k] === entry));
let total = 0;
for (const key of seen) {
  const file = manifest[key].file;
  if (!file.endsWith('.js')) continue;
  const size = statSync(join(dist, file)).size;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${file}`);
}
console.log(`startup JS: ${(total / 1024).toFixed(1)} KB (limit ${LIMIT_BYTES / 1024} KB)`);
process.exit(total > LIMIT_BYTES ? 1 : 0);
