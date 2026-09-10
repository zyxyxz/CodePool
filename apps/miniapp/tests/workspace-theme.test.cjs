const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const theme = require('../utils/theme');
const teamA = { teamId: 'sage-team', name: '研发空间', themeColor: '#15803D', role: 'owner' };
const teamB = { teamId: 'rose-team', name: '设计空间', themeColor: '#DB2777', role: 'admin' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mount(overrides = {}) {
  const storage = new Map();
  const chrome = [];
  const copies = [];
  const timers = new Map();
  let timerId = 0;
  let page;
  let app;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    setNavigationBarTitle() {},
    showToast() {},
    ...Object.fromEntries(['setNavigationBarColor', 'setBackgroundColor', 'setBackgroundTextStyle', 'setTabBarStyle', 'setTabBarItem'].map((name) => [name, (value) => chrome.push({ name, ...value })])),
  };
  const themeContext = { module: { exports: {} }, wx, getApp: () => app, getCurrentPages: () => [page] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/theme.js'), 'utf8'), themeContext);
  const runtimeTheme = themeContext.module.exports;
  const api = {
    fetchTeams: async () => app.globalData.teams,
    fetchAccounts: async (id) => [{ id: `${id}-key`, period: 30 }],
    fetchItems: async (id) => [{ id: `${id}-item`, kind: 'note' }],
    fetchAccountCode: async () => ({ code: '123456', period: 30, expiresIn: 20 }),
    ...overrides.api,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App(value) { app = value; }, wx,
    require(name) { return name.endsWith('/theme') ? runtimeTheme : api; },
  });
  app.globalData = { ...app.globalData, token: 'test-session', user: { id: 'me' }, activeTeamId: teamA.teamId, teams: [teamA, teamB] };
  app.awaitReady = async () => true;
  app.refreshPublicConfig = async () => ({});
  app.getStoredProfile = () => ({ nickname: '测试成员' });
  app.hasLegalConsent = () => true;
  const sandbox = {
    Page(value) { page = value; }, wx, getApp: () => app,
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/theme')) return runtimeTheme;
      if (name.endsWith('/clipboard')) return { copyText: async (value) => copies.push(value) };
      return require(path.resolve(root, 'pages/home', name));
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { timers.set(++timerId, callback); return timerId; },
    clearInterval(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${overrides.page || 'home'}/index.js`), 'utf8'), sandbox);
  page.data = structuredClone(page.data);
  page.setData = function setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); };
  page.setData({ teams: [teamA, teamB], currentTeam: teamA, teamIndex: 0 });
  page._codeRefreshing = {};
  page._hideTimers = {};
  return { app, page, api, storage, chrome, copies, timers, runtimeTheme };
}

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('all six existing team keys map to distinct muted palettes with readable controls', () => {
  assert.equal(new Set(theme.TEAM_COLORS.map((color) => theme.getTheme(color).key)).size, 6);
  for (const color of theme.TEAM_COLORS) {
    const palette = theme.getTheme(color.toLowerCase());
    assert.equal(palette.color, color);
    assert.ok(contrast(palette.accent, palette.surface) >= 4.5, `${palette.key} accent on surface`);
    assert.ok(contrast('#FFFFFF', palette.accent) >= 4.5, `${palette.key} filled button label`);
    assert.ok(contrast(palette.ink, palette.heroStart) >= 7, `${palette.key} workspace name`);
    assert.ok(contrast(palette.muted, palette.bg) >= 4.5, `${palette.key} secondary text`);
    for (const background of [palette.surface, palette.tint, palette.heroStart, palette.heroEnd]) {
      assert.ok(contrast(palette.accent, background) >= 4.5, `${palette.key} accent text on ${background}`);
      assert.ok(contrast(palette.muted, background) >= 4.5, `${palette.key} secondary text on ${background}`);
    }
  }
  assert.equal(theme.getTheme('unexpected; color:red').key, 'sage');
  assert.equal(theme.getTheme(null).key, 'sage');
  assert.match(theme.getThemeStyle(teamB.themeColor), /--cp-bg:#FBF4F6/);
});

test('visible theme updates native navigation, pull refresh and selected tab icons together', () => {
  const { page, runtimeTheme, chrome } = mount();
  runtimeTheme.applyPageTheme(page, teamB.themeColor);
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(chrome.find((call) => call.name === 'setNavigationBarColor').backgroundColor, '#FBF4F6');
  assert.equal(chrome.find((call) => call.name === 'setNavigationBarColor').frontColor, '#000000');
  assert.equal(chrome.find((call) => call.name === 'setBackgroundColor').backgroundColorTop, '#FBF4F6');
  assert.equal(chrome.find((call) => call.name === 'setTabBarStyle').selectedColor, '#875367');
  assert.equal(chrome.filter((call) => call.name === 'setTabBarItem' && call.selectedIconPath.includes('/rose/')).length, 4);
  const oldPage = { setData() {} };
  const count = chrome.length;
  runtimeTheme.applyPageTheme(oldPage, teamA.themeColor);
  assert.equal(chrome.length, count, 'hidden page cannot recolor current native chrome');
});

test('switching spaces changes theme and clears old content before the new request completes', async () => {
  const next = deferred();
  const { page, app, storage } = mount({ api: { fetchAccounts: (id) => id === teamB.teamId ? next.promise : Promise.resolve([]) } });
  page.setData({ accounts: [{ id: 'previous-secret' }], visibleAccounts: [{ id: 'previous-secret' }] });
  const pending = page.handleTeamChange({ detail: { value: 1 } });
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(page.data.currentTeam.teamId, teamB.teamId);
  assert.equal(page.data.accounts.length, 0);
  assert.equal(page.data.visibleAccounts.length, 0);
  assert.equal(app.globalData.activeTeamId, teamB.teamId);
  assert.equal(storage.get('CODEPOOL_ACTIVE_THEME').color, teamB.themeColor);
  next.resolve([{ id: 'new-secret' }]);
  await pending;
  assert.equal(page.data.accounts[0].id, 'new-secret');
});

test('a delayed old-team result cannot appear beneath the newly selected team theme', async () => {
  const previous = deferred();
  const { page } = mount({ api: { fetchAccounts: (id) => id === teamA.teamId ? previous.promise : Promise.resolve([{ id: 'design-key' }]) } });
  const oldLoad = page.loadData();
  await page.handleTeamChange({ detail: { value: 1 } });
  previous.resolve([{ id: 'old-private-key' }]);
  await oldLoad;
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(page.data.accounts[0].id, 'design-key');
  assert.equal(page.data.visibleVaultItems[0].id, `${teamB.teamId}-item`);
});

test('a delayed old-team failure cannot replace the selected workspace with an error', async () => {
  const previous = deferred();
  const { page } = mount({ api: { fetchAccounts: (id) => id === teamA.teamId ? previous.promise : Promise.resolve([]) } });
  const oldLoad = page.loadData();
  await page.handleTeamChange({ detail: { value: 1 } });
  previous.reject(new Error('旧团队已无权限'));
  await oldLoad;
  assert.equal(page.data.error, '');
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(page.data.loading, false);
});

test('failed new-team content loading keeps its chosen theme and never restores previous content', async () => {
  const { page } = mount({ api: { fetchAccounts: async () => { throw new Error('网络中断'); } } });
  page.setData({ accounts: [{ id: 'old-key' }], visibleAccounts: [{ id: 'old-key' }] });
  await page.handleTeamChange({ detail: { value: 1 } });
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(page.data.currentTeam.teamId, teamB.teamId);
  assert.equal(page.data.visibleAccounts.length, 0);
  assert.equal(page.data.error, '网络中断');
});

test('returning from another tab restores selected theme even when refreshing teams fails', async () => {
  const { page, app, chrome } = mount({ api: { fetchTeams: async () => { throw new Error('空间列表暂不可用'); } } });
  page.setData({ accounts: [{ id: 'old-key' }], visibleAccounts: [{ id: 'old-key' }] });
  app.setActiveTeam(teamB.teamId);
  await page.onShow();
  assert.equal(page.data.theme.key, 'rose');
  assert.equal(page.data.currentTeam.teamId, teamB.teamId);
  assert.equal(page.data.visibleAccounts.length, 0);
  assert.equal(chrome.filter((call) => call.name === 'setTabBarStyle').at(-1).selectedColor, '#875367');
});

test('fresh metadata changes the same workspace theme and persists the updated color', async () => {
  const updated = { ...teamA, themeColor: '#7C3AED' };
  const { page, storage } = mount({ api: { fetchTeams: async () => [updated, teamB] } });
  await page.bootstrap();
  assert.equal(page.data.currentTeam.teamId, teamA.teamId);
  assert.equal(page.data.theme.key, 'lilac');
  assert.equal(storage.get('CODEPOOL_ACTIVE_THEME').color, '#7C3AED');
});

test('a delayed reveal or copy cannot expose a previous space code after switching or hiding', async () => {
  for (const action of ['switch', 'hide']) {
    const code = deferred();
    const { page, copies, timers } = mount({ api: { fetchAccountCode: () => code.promise } });
    page.setData({ accounts: [{ id: 'old-key', code: '' }], visibleAccounts: [{ id: 'old-key' }] });
    const pending = page.handleCopyCode({ currentTarget: { dataset: { id: 'old-key' } } });
    if (action === 'switch') await page.handleTeamChange({ detail: { value: 1 } });
    else page.onHide();
    code.resolve({ code: '654321', period: 30, expiresIn: 20 });
    await pending;
    assert.equal(copies.length, 0);
    assert.equal(timers.size, 0);
    assert.ok(page.data.accounts.every((account) => account.code !== '654321'));
  }
});

test('later same-team searches take precedence over older pending searches', async () => {
  const first = deferred();
  const { page } = mount({ api: { fetchAccounts: (id, query) => query === 'first' ? first.promise : Promise.resolve([{ id: 'second-result' }]) } });
  page.setData({ query: 'first' });
  const oldLoad = page.loadData({ silent: true });
  page.setData({ query: 'second' });
  await page.loadData({ silent: true });
  first.resolve([{ id: 'first-result' }]);
  await oldLoad;
  assert.equal(page.data.accounts[0].id, 'second-result');
});

test('stored theme survives reopening while awaiting metadata and resets when session is cleared', () => {
  const { app, api, storage, runtimeTheme } = mount();
  app.setActiveTeam(teamB.teamId);
  app.globalData.teams = [];
  app.globalData.activeTeamId = null;
  app.globalData.activeThemeColor = '#15803D';
  api.onUnauthorized = () => {};
  api.setToken = () => {};
  app.observeNetwork = () => {};
  app.tryRestoreSession = async () => true;
  app.onLaunch({});
  assert.equal(app.globalData.activeTeamId, teamB.teamId);
  assert.equal(runtimeTheme.getActiveThemeColor(app), teamB.themeColor);
  app.clearSession(true);
  assert.equal(runtimeTheme.getActiveThemeColor(app), teamA.themeColor);
  assert.equal(storage.has('CODEPOOL_ACTIVE_THEME'), false);
});

test('late audit team-list responses cannot restore a previous account team or theme', async () => {
  const oldTeams = deferred();
  const { page, app } = mount({ page: 'logs', api: { fetchTeams: () => oldTeams.promise } });
  const pending = page.initialize();
  await new Promise(setImmediate);
  app.globalData.token = 'new-session';
  app.globalData.teams = [teamB];
  app.globalData.activeTeamId = teamB.teamId;
  page.setData({ teams: [teamB], currentTeam: teamB, ...theme.getThemeData(teamB.themeColor) });
  oldTeams.resolve([teamA]);
  await pending;
  assert.equal(app.globalData.activeTeamId, teamB.teamId);
  assert.equal(app.globalData.teams[0].teamId, teamB.teamId);
  assert.equal(page.data.theme.key, 'rose');
});
