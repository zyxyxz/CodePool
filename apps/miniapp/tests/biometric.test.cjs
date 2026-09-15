const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('biometric preference defaults off, is per account and never stores unlock grants', () => {
  const storage = new Map(); const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/biometric.js'), 'utf8'), { module, wx: { getStorageSync: (k) => storage.get(k), setStorageSync: (k, v) => storage.set(k, v) } });
  const bio = module.exports;
  assert.equal(bio.enabled('one'), false);
  bio.setEnabled('one', true);
  assert.equal(bio.enabled('one'), true); assert.equal(bio.enabled('two'), false);
  assert.deepEqual([...storage.values()], [true]);
  bio.setEnabled('one', false); assert.equal(bio.enabled('one'), false);
});
test('failed facial enrollment detection still checks fingerprint', async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/biometric.js'), 'utf8'), { module, wx: {
    checkIsSupportSoterAuthentication: (o) => o.success({ supportMode: ['facial', 'fingerPrint'] }),
    checkIsSoterEnrolledInDevice: (o) => o.checkAuthMode === 'facial' ? o.fail({}) : o.success({ isEnrolled: true }),
  } });
  assert.equal((await module.exports.capability()).mode, 'fingerPrint');
});
function lockPage({ enabled = true, configured = true, mode = 'facial', changing = false } = {}) {
  let page; let attempts = 0;
  const api = { lockStatus: async () => ({ configured }), isUnlocked: () => true };
  const bio = { enabled: () => enabled, capability: async () => ({ mode, label: '人脸识别', hint: '设备状态' }), authenticate: async () => { attempts++; throw new Error('已取消'); } };
  const app = { _lockEpoch: 0, globalData: { token: 'session', user: { id: 'one' } }, awaitReady: async () => true };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/lock/index.js'), 'utf8'), {
    Page: (p) => { page = p; }, getApp: () => app, wx: {},
    require: (name) => name.endsWith('/api') ? api : name.endsWith('/biometric') ? bio : { getThemeData: () => ({}), applyPageTheme() {} },
  });
  page.setData = (data) => Object.assign(page.data, data); page.onLoad({ change: changing ? '1' : '' });
  return { page, attempts: () => attempts };
}
test('enabled lock auto-prompts once, cancellation allows PIN without a prompt loop', async () => {
  const f = lockPage(); await f.page.onShow();
  assert.equal(f.attempts(), 1); assert.equal(f.page.data.showPin, false);
  await f.page.onShow(); assert.equal(f.attempts(), 1);
  f.page.usePin(); assert.equal(f.page.data.showPin, true);
});
test('disabled, unsupported, setup and PIN-change flows never auto-prompt', async () => {
  for (const config of [{ enabled: false }, { mode: '' }, { configured: false }, { changing: true }]) {
    const f = lockPage(config); await f.page.onShow();
    assert.equal(f.attempts(), 0); assert.equal(f.page.data.showPin, true);
  }
});
test('settings enables only after verified authentication; failed enable stays off', async () => {
  for (const succeeds of [true, false]) {
    let page; let enabled = false;
    const bio = { enabled: () => enabled, setEnabled: (_id, value) => { enabled = value; }, capability: async () => ({ mode: 'facial' }), authenticate: async () => { if (!succeeds) throw new Error('cancelled'); return { token: 'verified' }; } };
    const app = { _lockEpoch: 0, globalData: { user: { id: 'one' } }, isVaultLocked: () => false, acceptUnlock: () => true };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/settings/index.js'), 'utf8'), {
      Page: (p) => { page = p; }, getApp: () => app, wx: { showToast() {} },
      require: (name) => name.endsWith('/biometric') ? bio : name.endsWith('/theme') ? { getThemeData: () => ({}) } : {},
    });
    page.setData = (data) => Object.assign(page.data, data);
    await page.toggleBiometric({ detail: { value: true } });
    assert.equal(enabled, succeeds); assert.equal(page.data.bioEnabled, succeeds);
    await page.toggleBiometric({ detail: { value: false } });
    assert.equal(enabled, false);
  }
});
test('first PIN setup opts in by default; opt-out, unsupported and cancellation never enable it', async () => {
  for (const scenario of ['default', 'opt-out', 'unsupported', 'cancel', 'existing-off']) {
    let page; let enabled = false; let attempts = 0; let action; let finished = false;
    const app = { _lockEpoch: 1, globalData: { user: { id: 'new' } }, acceptUnlock: () => true, consumePendingInvite: async () => {}, isVaultLocked: () => false };
    const bio = { setEnabled: (_id, value) => { enabled = value; }, authenticate: async () => { attempts++; if (scenario === 'cancel') throw new Error('cancel'); return { token: 'bio' }; } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/lock/index.js'), 'utf8'), {
      Page: (p) => { page = p; }, getApp: () => app, wx: { showToast() {}, reLaunch() { finished = true; } },
      require: (name) => name.endsWith('/api') ? { unlock: async (input) => { action = input.action; return { token: 'pin' }; } } : name.endsWith('/biometric') ? bio : { getThemeData: () => ({}) },
    });
    page.setData = (data) => Object.assign(page.data, data);
    page.setData({ loading: false, bioChecking: false, authMode: scenario === 'unsupported' ? '' : 'facial', configured: scenario === 'existing-off' });
    assert.equal(page.data.setupBiometric, true);
    if (scenario === 'opt-out') page.onSetupBiometric({ detail: { value: false } });
    await page.submit({ detail: { value: { pin: '827194', confirmPin: '827194' } } });
    assert.equal(action, scenario === 'existing-off' ? 'pin' : 'setup');
    assert.equal(enabled, scenario === 'default');
    assert.equal(attempts, ['default', 'cancel'].includes(scenario) ? 1 : 0);
    assert.equal(page.data.configured, true); assert.equal(finished, true);
  }
});
