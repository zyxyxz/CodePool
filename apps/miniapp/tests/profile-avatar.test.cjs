const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const miniappRoot = path.resolve(__dirname, '..');

function clearMiniappModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(miniappRoot)) delete require.cache[modulePath];
  }
}

function setData(target, updates) {
  for (const [key, value] of Object.entries(updates)) {
    const segments = key.split('.');
    let current = target.data;
    while (segments.length > 1) {
      const segment = segments.shift();
      current[segment] = current[segment] || {};
      current = current[segment];
    }
    current[segments[0]] = value;
  }
}

test('device avatar fallback uses the selected image', async () => {
  clearMiniappModules();
  let appDefinition;
  global.App = (definition) => { appDefinition = definition; };
  global.wx = {
    getStorageSync: () => '',
    chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/avatar.jpg' }] }),
  };
  require(path.join(miniappRoot, 'app.js'));
  appDefinition.requestPrivacyAuthorization = async () => true;

  assert.equal(await appDefinition.chooseAvatarImage(), 'wxfile://tmp/avatar.jpg');
});

test('official avatar selection persists and uploads immediately for a member', async () => {
  clearMiniappModules();
  const storedProfile = {
    nickname: 'CodePool User',
    avatarUrl: '/assets/avatar-default.png',
    avatar_url: '/assets/avatar-default.png',
    pendingAvatar: false,
  };
  let syncCalls = 0;
  const app = {
    globalData: {
      token: 'member-token',
      user: { id: '11111111-1111-4111-8111-111111111111', nickname: storedProfile.nickname, createdAt: '2026-08-20T00:00:00.000Z' },
      teams: [],
      privacyMask: true,
    },
    getStoredProfile: () => ({ ...storedProfile }),
    hasLegalConsent: () => true,
    persistAvatarFile: async () => 'wxfile://usr/avatar.jpg',
    setStoredProfile: (update) => Object.assign(storedProfile, update),
    syncStoredProfile: async (options) => {
      assert.deepEqual(options, { updateNickname: false });
      syncCalls += 1;
      Object.assign(storedProfile, {
        avatarUrl: 'https://codepool.apps.aisp24.com/api/v1/avatars/user?v=2',
        avatar_url: 'https://codepool.apps.aisp24.com/api/v1/avatars/user?v=2',
        pendingAvatar: false,
      });
    },
  };
  const toasts = [];
  global.getApp = () => app;
  global.Page = (definition) => { global.__profilePage = definition; };
  global.wx = {
    getStorageSync: () => '',
    getAccountInfoSync: () => ({ miniProgram: { version: '0.3.2' } }),
    showToast: (options) => toasts.push(options),
  };
  require(path.join(miniappRoot, 'pages/profile/index.js'));
  const page = {
    ...global.__profilePage,
    data: structuredClone(global.__profilePage.data),
    setData(updates) { setData(this, updates); },
  };
  page.setData({ 'profile.nickname': 'Unsaved nickname draft' });

  await page.handleChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });

  assert.equal(syncCalls, 1);
  assert.equal(page.data.avatarProcessing, false);
  assert.equal(page.data.profile.pendingAvatar, false);
  assert.match(page.data.profile.avatarUrl, /^https:\/\/codepool\.apps\.aisp24\.com\//);
  assert.equal(page.data.profile.nickname, 'Unsaved nickname draft');
  assert.equal(toasts.at(-1).title, '头像已更新');
});
