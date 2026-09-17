const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function mount() {
  let now = 1000000;
  const clock = { now: () => now };
  const requests = []; const navigations = []; let app;
  const page = { route: 'pages/item/detail/index', _plainContent: 'sensitive', data: { content: 'sensitive', form: { secret: 'seed' } }, setData(data) { Object.assign(this.data, data); } };
  const wx = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {}, request(options) { requests.push(options); }, reLaunch(options) { navigations.push(options.url); options.complete?.(); } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8'), {
    module, wx, getApp: () => app, Date: clock,
    require(name) { return name === '../config' ? { BASE_URL: 'https://local.test', API_PREFIX: '/api/v1', CLIENT_VERSION: 'test' } : { normalizeThemeColor: (v) => v }; },
  });
  const api = module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App(value) { app = value; }, wx, getCurrentPages: () => [page],
    setTimeout: () => 1, clearTimeout() {},
    require(name) { return name === './utils/api' ? api : { normalizeThemeColor: (v) => v, applyPageTheme() {} }; },
  });
  app._lockEnabled = true; app._lockEpoch = 0; app._foreground = true;
  app.globalData.token = 'session'; app.globalData.user = { id: 'user', profileCompleted: true };
  api.setToken('session'); api.enableVaultLock();
  app.refreshPublicConfig = () => {};
  return { api, app, wx, requests, page, navigations, advance: (ms) => { now += ms; } };
}
test('locked client refuses business API requests and starts unlock flow', async () => {
  const { api, app, requests, navigations } = mount();
  await assert.rejects(() => api.request({ url: '/items/item' }), /解锁/);
  assert.equal(requests.length, 0);
  assert.equal(app.openVaultLock(), true);
  assert.equal(navigations[0], '/pages/lock/index');
});
test('manual locking clears memory, drafts and rejects a late secret response', async () => {
  const { api, app, page, requests } = mount();
  app.acceptUnlock({ token: 'short-lived-grant', expiresIn: 600 }, 0);
  const response = api.request({ url: '/items/item' });
  assert.equal(requests[0].header['X-CodePool-Unlock'], 'short-lived-grant');
  app.lockVault();
  assert.equal(app.isVaultLocked(), true);
  assert.equal(page._plainContent, ''); assert.equal(page.data.content, '');
  assert.equal(page.data.form.secret, ''); assert.equal(page.data.vaultLocked, true);
  requests[0].success({ statusCode: 200, data: { code: 0, data: { content: 'late-secret' } } });
  await assert.rejects(() => response, /解锁/);
  assert.equal(app.acceptUnlock({ token: 'late-grant', expiresIn: 600 }, 0), false);
});
test('scan/background round trip keeps the page and form for the original ten minutes', () => {
  const { api, app, page, navigations, advance } = mount();
  app.acceptUnlock({ token: 'grant', expiresIn: 600 }, 0);
  advance(300000); app.onHide(); app.onShow();
  assert.equal(api.isUnlocked(), true); assert.equal(app._lockEpoch, 0);
  assert.equal(page.data.form.secret, 'seed'); assert.equal(navigations.length, 0);
  advance(300000); app.onShow();
  assert.equal(api.isUnlocked(), false); assert.equal(page.data.form.secret, '');
  assert.equal(navigations[0], '/pages/lock/index');
});
test('background return after expiry locks even when the JS timer was suspended', () => {
  const { app, page, navigations, advance } = mount();
  app.acceptUnlock({ token: 'grant', expiresIn: 600 }, 0);
  app.onHide(); advance(600001); app.onShow();
  assert.equal(app.isVaultLocked(), true); assert.equal(page.data.form.secret, '');
  assert.equal(navigations[0], '/pages/lock/index');
});
test('unlock never survives a freshly initialized client', () => {
  const { api, app } = mount();
  assert.equal(app.acceptUnlock({ token: 'grant', expiresIn: 600 }, 0), true);
  api.enableVaultLock();
  assert.equal(app.isVaultLocked(), true);
});
test('QR scan round trip fills the current form; results after expiry are discarded', async () => {
  for (const expired of [false, true]) {
    const { app, api, wx, page, advance, navigations } = mount();
    let resolveScan;
    wx.scanCode = () => new Promise((resolve) => { resolveScan = resolve; });
    wx.showToast = () => {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/account/add/index.js'), 'utf8'), {
      Page(value) { Object.assign(page, value); }, getApp: () => app, wx,
      require(name) { return name.endsWith('/api') ? api : { getThemeData: () => ({}) }; },
    });
    page.setData = (data) => { for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('form.')) page.data.form[key.slice(5)] = value;
      else page.data[key] = value;
    } };
    app.acceptUnlock({ token: 'grant', expiresIn: 600 }, 0);
    const pending = page.handleScan(); app.onHide();
    advance(expired ? 600001 : 30000); app.onShow();
    resolveScan({ result: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example' });
    await pending;
    assert.equal(page.data.form.secret, expired ? '' : 'JBSWY3DPEHPK3PXP');
    assert.equal(navigations.length, expired ? 1 : 0);
    if (!expired) assert.equal(page.data.form.issuer, 'Example');
  }
});
