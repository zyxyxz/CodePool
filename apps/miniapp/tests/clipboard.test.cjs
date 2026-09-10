const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function loadClipboard(wx, authorize = async () => {}) {
  const context = { module: { exports: {} }, wx, getApp: () => ({ requestPrivacyAuthorization: authorize }) };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../utils/clipboard.js'), 'utf8'), context);
  return context.module.exports;
}

test('copy waits for the callback and shows success only after the clipboard write succeeds', async () => {
  let callback;
  let copied;
  const notices = [];
  const clipboard = loadClipboard({
    setClipboardData(options) { copied = options.data; callback = options.success; },
    showToast(options) { notices.push(options.title); },
  });
  const operation = clipboard.copyText('  invitation-token  ', { successMessage: '邀请码已复制' });
  await new Promise(setImmediate);
  assert.equal(copied, '  invitation-token  ');
  assert.deepEqual(notices, []);
  callback({ errMsg: 'setClipboardData:ok' });
  await operation;
  assert.deepEqual(notices, ['邀请码已复制']);
});

test('privacy declaration errors reject without claiming copy success', async () => {
  const notices = [];
  const clipboard = loadClipboard({
    setClipboardData({ fail }) { fail({ errno: 112, errMsg: 'setClipboardData:fail api scope is not declared in the privacy agreement' }); },
    showToast(options) { notices.push(options); },
  });
  await assert.rejects(clipboard.copyText('token'), { code: 'CLIPBOARD_PRIVACY_UNAVAILABLE' });
  assert.equal(notices.length, 0);
});

test('authorization rejection prevents reading private clipboard content', async () => {
  let reads = 0;
  const clipboard = loadClipboard({ getClipboardData() { reads += 1; } }, async () => { throw new Error('隐私授权未同意'); });
  await assert.rejects(clipboard.readClipboard(), /隐私授权未同意/);
  assert.equal(reads, 0);
});

test('paste resolves callback data even when the native API returns no Promise', async () => {
  const clipboard = loadClipboard({ getClipboardData({ success }) { success({ data: 'JBSWY3DPEHPK3PXP' }); } });
  assert.equal(await clipboard.readClipboard(), 'JBSWY3DPEHPK3PXP');
});

test('copy does not write a previous workspace code after delayed privacy approval', async () => {
  let approve;
  let current = true;
  const writes = [];
  const clipboard = loadClipboard({
    setClipboardData(options) { writes.push(options.data); options.success({}); },
    showToast() { throw new Error('cancelled copy must not report success'); },
  }, () => new Promise((resolve) => { approve = resolve; }));
  const pending = clipboard.copyText('654321', { isCurrent: () => current });
  current = false;
  approve();
  assert.equal(await pending, false);
  assert.deepEqual(writes, []);
});
