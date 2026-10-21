const test = require('node:test');
const assert = require('node:assert/strict');
const { setupWindowsToasts, APP_ID } = require('./win_toast');

function setup(over = {}) {
  const calls = { ids: [], links: [] };
  const result = setupWindowsToasts({
    platform: 'win32',
    isDev: false,
    execPath: 'C:\\Temp\\2abc\\Auto Read PDF Pro.exe',
    portableExe: undefined,
    appDataDir: 'C:\\Users\\sa\\AppData\\Roaming',
    setAppUserModelId: (id) => calls.ids.push(id),
    writeShortcutLink: (...args) => { calls.links.push(args); return true; },
    ...over,
  });
  return { result, calls };
}

test('does nothing outside Windows', () => {
  const { result, calls } = setup({ platform: 'darwin' });
  assert.equal(result, 'skipped');
  assert.deepEqual(calls, { ids: [], links: [] });
});

test('installed app: uses the id the installer put on its shortcut, writes no shortcut', () => {
  const { result, calls } = setup();
  assert.equal(result, 'installed');
  assert.deepEqual(calls.ids, [APP_ID]);
  assert.deepEqual(calls.links, []);
});

test('portable app: creates a Start Menu shortcut to the launched .exe carrying the id', () => {
  const { result, calls } = setup({ portableExe: 'D:\\Tools\\Auto-Read-PDF-Pro-Portable.exe' });
  assert.equal(result, 'portable');
  assert.deepEqual(calls.ids, [APP_ID]);
  assert.deepEqual(calls.links, [[
    'C:\\Users\\sa\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Auto Read PDF Pro (Portable).lnk',
    'create',
    { target: 'D:\\Tools\\Auto-Read-PDF-Pro-Portable.exe', appUserModelId: APP_ID, description: 'Auto Read PDF Pro' },
  ]]);
});

test("portable app: never overwrites the installer's shortcut", () => {
  const { calls } = setup({ portableExe: 'D:\\x.exe' });
  assert.notEqual(calls.links[0][0].split('\\').pop(), 'Auto Read PDF Pro.lnk');
});

test('portable app: a shortcut that cannot be written does not stop the app', () => {
  const { result } = setup({ portableExe: 'D:\\x.exe', writeShortcutLink: () => { throw new Error('denied'); } });
  assert.equal(result, 'portable-no-shortcut');
});

test('development: uses electron.exe path as the id', () => {
  const { result, calls } = setup({ isDev: true, execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe' });
  assert.equal(result, 'dev');
  assert.deepEqual(calls.ids, ['C:\\repo\\node_modules\\electron\\dist\\electron.exe']);
});
