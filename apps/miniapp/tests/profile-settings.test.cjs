const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const miniappRoot = path.resolve(__dirname, '..');

function createHarness(options = {}) {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(miniappRoot)) delete require.cache[modulePath];
  }
  const originalNickname = '原昵称';
  const user = { id: 'user-id', nickname: originalNickname, createdAt: '2026-08-20T00:00:00Z' };
  const storage = new Map([
    ['CODEPOOL_TOKEN', options.signedOut ? '' : 'test-token'],
    ['CODEPOOL_PROFILE', { nickname: originalNickname, avatarUrl: '/assets/avatar-default.png' }],
    ['CODEPOOL_LEGAL_CONSENT', { version: '2026-08-17', acceptedAt: '2026-08-20' }],
  ]);
  const requests = [];
  const toasts = [];
  const modals = [];
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getAccountInfoSync: () => ({ miniProgram: { version: '0.3.4' } }),
    showToast: (value) => toasts.push(value),
    showModal: async (value) => {
      modals.push(value);
      return options.modalResult || { confirm: true, content: '' };
    },
    request: (request) => {
      requests.push(request);
      if (options.request) return options.request(request, user);
      if (request.method === 'PATCH') Object.assign(user, request.data);
      const data = request.url.endsWith('/auth/deletion-request')
        ? { request: null, canRequest: true, canWithdraw: false }
        : { user: { ...user }, teams: [] };
      request.success({ statusCode: 200, data: { code: 0, data } });
    },
  };
  let app;
  global.App = (definition) => { app = definition; };
  require(path.join(miniappRoot, 'app.js'));
  app.globalData = { ...app.globalData, token: options.signedOut ? '' : 'test-token', user: { ...user }, teams: [] };
  app.awaitReady = async () => Boolean(app.globalData.token);
  global.getApp = () => app;

  function pageFor(name) {
    let page;
    global.Page = (definition) => { page = definition; };
    require(path.join(miniappRoot, `pages/${name}/index.js`));
    page.data = structuredClone(page.data);
    page.setData = (updates) => {
      for (const [key, value] of Object.entries(updates)) {
        const segments = key.split('.');
        let target = page.data;
        while (segments.length > 1) target = target[segments.shift()];
        target[segments[0]] = value;
      }
    };
    return page;
  }
  return { app, pageFor, storage, requests, toasts, modals, user };
}

function nicknameForm(nickname) {
  return { detail: { value: { nickname } } };
}

test('profile saves the native form nickname through PATCH, without relying on input or review callbacks', async () => {
  const harness = createHarness();
  const page = harness.pageFor('profile');
  await page.handleSaveProfile(nicknameForm('  微信自动填入的新昵称  '));

  const writes = harness.requests.filter((request) => request.method === 'PATCH');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].url.endsWith('/api/v1/auth/me'));
  assert.deepEqual(writes[0].data, { nickname: '微信自动填入的新昵称' });
  assert.equal(page.data.profile.nickname, '微信自动填入的新昵称');
  assert.equal(harness.toasts.at(-1).title, '资料已更新');
  assert.equal(page.data.saving, false);
});

test('nickname save skips an expired pending avatar file and preserves it for an explicit retry', async () => {
  const harness = createHarness();
  const staleAvatar = 'wxfile://tmp/expired-avatar.jpg';
  harness.app.setStoredProfile({ avatarUrl: staleAvatar, avatar_url: staleAvatar, pendingAvatar: true });
  let avatarOperations = 0;
  global.wx.compressImage = () => { avatarOperations += 1; throw new Error('stale avatar must not be compressed'); };
  global.wx.getFileSystemManager = () => { avatarOperations += 1; throw new Error('stale avatar must not be read'); };
  const page = harness.pageFor('profile');

  await page.handleSaveProfile(nicknameForm('独立保存昵称'));

  assert.equal(avatarOperations, 0);
  assert.deepEqual(harness.requests.find((request) => request.method === 'PATCH').data, { nickname: '独立保存昵称' });
  assert.equal(harness.user.nickname, '独立保存昵称');
  assert.equal(harness.app.getStoredProfile().pendingAvatar, true);
  assert.equal(harness.app.getStoredProfile().avatarUrl, staleAvatar);
  assert.equal(page.data.profile.pendingAvatar, true);
  assert.equal(page.data.profile.avatarUrl, staleAvatar);
  assert.equal(harness.toasts.at(-1).title, '资料已更新');
});

test('failed nickname save preserves the pending avatar and previously saved nickname', async () => {
  const harness = createHarness({ request: (request, user) => {
    if (request.method === 'PATCH') request.fail({ errMsg: 'request:fail network unavailable' });
    else request.success({ statusCode: 200, data: { code: 0, data: { user: { ...user }, teams: [] } } });
  } });
  const staleAvatar = 'wxfile://usr/missing-avatar.jpg';
  harness.app.setStoredProfile({ avatarUrl: staleAvatar, avatar_url: staleAvatar, pendingAvatar: true });
  global.wx.getFileSystemManager = () => { throw new Error('stale avatar must not be read'); };
  const page = harness.pageFor('profile');

  await page.handleSaveProfile(nicknameForm('稍后重试'));

  assert.equal(harness.app.getStoredProfile().nickname, '原昵称');
  assert.equal(harness.app.getStoredProfile().pendingAvatar, true);
  assert.equal(harness.app.getStoredProfile().avatarUrl, staleAvatar);
  assert.equal(page.data.saving, false);
  assert.match(harness.toasts.at(-1).title, /网络/);
});

test('normal profile sync still reads, uploads and clears a pending avatar', async () => {
  const uploadedAvatar = 'https://codepool.apps.aisp24.com/api/v1/avatars/user?v=2';
  const harness = createHarness({ request: (request, user) => {
    if (request.method === 'PATCH') Object.assign(user, { nickname: request.data.nickname, avatarUrl: uploadedAvatar });
    request.success({ statusCode: 200, data: { code: 0, data: { user: { ...user }, teams: [] } } });
  } });
  harness.app.setStoredProfile({ avatarUrl: 'wxfile://usr/avatar.jpg', pendingAvatar: true });
  let compressCalls = 0;
  let readCalls = 0;
  global.wx.compressImage = ({ success }) => {
    compressCalls += 1;
    success({ tempFilePath: 'wxfile://tmp/compressed.jpg' });
  };
  global.wx.getFileSystemManager = () => ({
    readFile: ({ filePath, success }) => {
      readCalls += 1;
      assert.equal(filePath, 'wxfile://tmp/compressed.jpg');
      success({ data: '/9j/AAAA' });
    },
  });

  await harness.app.syncStoredProfile();

  const write = harness.requests.find((request) => request.method === 'PATCH');
  assert.equal(compressCalls, 1);
  assert.equal(readCalls, 1);
  assert.deepEqual(write.data, { nickname: '原昵称', avatar: { data: '/9j/AAAA', mimeType: 'image/jpeg' } });
  assert.equal(harness.app.getStoredProfile().avatarUrl, uploadedAvatar);
  assert.equal(harness.app.getStoredProfile().pendingAvatar, false);
});

test('a nickname cleared by native review cannot fall back to an old cached draft', async () => {
  const harness = createHarness();
  const page = harness.pageFor('profile');
  page.data.profile.nickname = '未通过审核的旧草稿';
  page.handleNicknameReview({ detail: { pass: false, timeout: false } });
  await page.handleSaveProfile(nicknameForm(''));

  assert.equal(harness.requests.length, 0);
  assert.equal(harness.app.getStoredProfile().nickname, '原昵称');
  assert.equal(page.data.saving, false);
  assert.match(harness.toasts.at(-1).title, /请输入昵称/);
});

test('nickname review timeout does not lock the input or prevent a corrected form from being saved', async () => {
  const harness = createHarness();
  const page = harness.pageFor('profile');
  page.handleNicknameReview({ detail: { pass: false, timeout: true } });
  await page.handleSaveProfile(nicknameForm('重试后的昵称'));

  assert.equal(harness.user.nickname, '重试后的昵称');
  assert.equal(page.data.saving, false);
  assert.equal(harness.toasts.at(-1).title, '资料已更新');
});

test('failed profile PATCH leaves the saved nickname unchanged and allows retry', async () => {
  let shouldFail = true;
  const harness = createHarness({ request: (request, user) => {
    if (request.method === 'PATCH' && shouldFail) {
      request.fail({ errMsg: 'request:fail network unavailable' });
      return;
    }
    if (request.method === 'PATCH') Object.assign(user, request.data);
    request.success({ statusCode: 200, data: { code: 0, data: { user: { ...user }, teams: [] } } });
  } });
  const page = harness.pageFor('profile');
  await page.handleSaveProfile(nicknameForm('待重试昵称'));
  assert.equal(harness.app.getStoredProfile().nickname, '原昵称');
  assert.equal(page.data.saving, false);
  assert.match(harness.toasts.at(-1).title, /网络/);

  shouldFail = false;
  await page.handleSaveProfile(nicknameForm('待重试昵称'));
  assert.equal(harness.user.nickname, '待重试昵称');
  assert.equal(harness.toasts.at(-1).title, '资料已更新');
});

for (const pageName of ['home', 'team', 'profile']) {
  test(`${pageName} login uses the native submitted nickname and rejects an empty reviewed form`, async () => {
    const harness = createHarness({ signedOut: true });
    const page = harness.pageFor(pageName);
    page.setData({ legalConsent: true });
    let loginCalls = 0;
    harness.app.ensureLogin = async () => { loginCalls += 1; harness.app.globalData.token = 'test-token'; };
    page.bootstrap = async () => {};
    page.initialize = async () => {};

    await page.handleLogin(nicknameForm(''));
    assert.equal(loginCalls, 0);
    await page.handleLogin(nicknameForm('微信登录昵称'));
    assert.equal(loginCalls, 1);
    assert.equal(harness.app.getStoredProfile().nickname, '微信登录昵称');
    assert.equal(page.data.loginLoading, false);
  });
}

test('settings signed-out access makes no account request and guards cancellation', async () => {
  const harness = createHarness({ signedOut: true });
  const page = harness.pageFor('settings');
  await page.onShow();
  await page.handleCancellation();
  assert.equal(page.data.needsLogin, true);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.modals.length, 0);
});

test('settings retains cancellation withdrawal and clears account controls after logout', async () => {
  let withdrawn = false;
  const harness = createHarness({ request: (request) => {
    if (request.method === 'DELETE') withdrawn = true;
    request.success({ statusCode: 200, data: { code: 0, data: {
      request: { status: withdrawn ? 'cancelled' : 'pending', requestedAt: '2026-08-20T00:00:00Z' },
      canRequest: withdrawn,
      canWithdraw: !withdrawn,
    } } });
  } });
  const page = harness.pageFor('settings');
  await page.onShow();
  assert.equal(page.data.canWithdrawDeletion, true);
  await page.handleCancellation();
  assert.equal(withdrawn, true);
  assert.equal(page.data.deletionStatusLabel, '已撤回');
  await page.handleLogout();
  assert.equal(page.data.needsLogin, true);
  assert.equal(page.data.deletionRequest, null);
  assert.equal(page.data.canRequestDeletion, false);
});

test('late account status responses after logout cannot restore account information', async () => {
  let pendingRequest;
  const harness = createHarness({ request: (request) => { pendingRequest = request; } });
  const page = harness.pageFor('settings');
  const loading = page.onShow();
  await Promise.resolve();
  await page.handleLogout();
  pendingRequest.success({ statusCode: 200, data: { code: 0, data: {
    request: { status: 'pending' }, canRequest: false, canWithdraw: true,
  } } });
  await loading;
  assert.equal(page.data.needsLogin, true);
  assert.equal(page.data.deletionRequest, null);
  assert.equal(page.data.canWithdrawDeletion, false);
});
