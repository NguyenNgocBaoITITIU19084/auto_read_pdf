const test = require('node:test');
const assert = require('node:assert/strict');
const { findNewerRelease, isNewer, plainNotes } = require('./release_check');

const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('compares versions numerically, not as text', () => {
  assert.equal(isNewer('2.10.0', '2.9.0'), true);
  assert.equal(isNewer('v3.0.0', '2.9.9'), true);
  assert.equal(isNewer('2.9.0', '2.9.0'), false);
  assert.equal(isNewer('2.8.5', '2.9.0'), false);
  assert.equal(isNewer('nightly', '2.9.0'), false);
});

test('turns HTML and Markdown release notes into plain text', () => {
  assert.equal(plainNotes('<h2>Mới</h2><ul><li>Đọc booking Topaz</li><li>Lịch &amp; nhắc</li></ul>'), 'Mới\n• Đọc booking Topaz\n• Lịch & nhắc');
  assert.equal(plainNotes('**Full Changelog**: x'), 'Full Changelog: x');
  assert.equal(plainNotes([{ note: '<p>a</p>' }, { note: 'b' }]), 'a\nb');
  assert.equal(plainNotes(null), '');
});

test('reports a newer release with its notes and page', async () => {
  const found = await findNewerRelease('2.9.0', reply({ tag_name: 'v2.10.0', body: '**Mới**', html_url: 'https://example/r' }));
  assert.deepEqual(found, { version: '2.10.0', notes: 'Mới', url: 'https://example/r' });
});

test('nothing when the latest release is the current one or a pre-release', async () => {
  assert.equal(await findNewerRelease('2.9.0', reply({ tag_name: 'v2.9.0' })), null);
  assert.equal(await findNewerRelease('2.9.0', reply({ tag_name: 'v3.0.0', prerelease: true })), null);
});

test('an HTTP error is thrown for the caller to log', async () => {
  await assert.rejects(findNewerRelease('2.9.0', reply({}, false, 403)), /GitHub HTTP 403/);
});
