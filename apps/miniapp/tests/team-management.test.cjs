const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const miniappRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(miniappRoot, 'pages/team/index.js'), 'utf8');
const teamA = { teamId: 'team-a', name: '研发团队', themeColor: '#15803D', role: 'owner', memberCount: 2, itemCount: 3 };
const teamB = { teamId: 'team-b', name: '产品团队', themeColor: '#2563EB', role: 'admin', memberCount: 1, itemCount: 0 };

function mount(overrides = {}) {
  const toasts = [];
  const copied = [];
  const updates = [];
  const timers = new Map();
  let timerId = 0;
  let page;
  const app = {
    globalData: { token: 'mock-session', user: { id: 'self' }, teams: [teamA, teamB], activeTeamId: teamA.teamId },
    getStoredProfile: () => ({ nickname: '测试成员' }),
    hasLegalConsent: () => true,
    awaitReady: async () => true,
    guardMaintenance: async () => true,
    setActiveTeam: (id) => { app.globalData.activeTeamId = id; },
    refreshMe: async () => undefined,
  };
  const api = {
    fetchTeams: async () => app.globalData.teams,
    fetchTeamMembers: async () => [],
    fetchTeamInvites: async () => [],
    updateTeam: async (id, payload) => {
      updates.push({ id, ...payload });
      return { ...teamA, ...payload };
    },
    createTeamInvite: async (id, payload) => ({ id: 'invite-1', teamId: id, token: 'full-token-with_all-32_characters', role: payload.role, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    acceptInvite: async () => ({ teamId: teamB.teamId }),
    ...overrides.api,
  };
  const clipboard = {
    copyText: async (token, options) => { copied.push({ token, options }); },
    readClipboard: async () => 'pasted-invite-token',
    ...overrides.clipboard,
  };
  vm.runInNewContext(source, {
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/clipboard')) return {
        copyText: (...args) => clipboard.copyText(...args),
        readClipboard: (...args) => clipboard.readClipboard(...args),
      };
      return require(path.resolve(miniappRoot, 'pages/team', name));
    },
    Page(definition) { page = definition; },
    getApp: () => app,
    wx: { showToast: (options) => toasts.push(options), showShareMenu: () => undefined, ...overrides.wx },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  page.setData = function setData(updates, callback) {
    for (const [key, value] of Object.entries(updates)) {
      const keys = key.split('.');
      let current = this.data;
      for (const segment of keys.slice(0, -1)) current = current[segment];
      current[keys.at(-1)] = value;
    }
    if (callback) callback();
  };
  page.setData({ loading: false, teams: [structuredClone(teamA), structuredClone(teamB)], currentTeam: structuredClone(teamA), canManage: true });
  page.ensureInviteOwner();
  return { page, app, api, clipboard, toasts, copied, updates, timers };
}

test('team editor submits the native name and chosen theme, updating the shared team state', async () => {
  const { page, app, updates, toasts } = mount();
  page.handleEditTeam();
  page.handleTeamNameInput({ detail: { value: '旧输入缓存' } });
  page.handleThemeChange({ currentTarget: { dataset: { color: '#7C3AED' } } });
  await page.handleSaveTeam({ detail: { value: { teamName: '  新研发空间  ' } } });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, '新研发空间');
  assert.equal(updates[0].themeColor, '#7C3AED');
  assert.equal(page.data.currentTeam.name, '新研发空间');
  assert.equal(app.globalData.teams[0].themeColor, '#7C3AED');
  assert.equal(page.data.teamEditorOpen, false);
  assert.equal(toasts.at(-1).title, '团队设置已更新');
});

test('team editor keeps drafts and an actionable error after a failed save, then permits retry', async () => {
  let attempts = 0;
  const { page } = mount({ api: { updateTeam: async (id, payload) => {
    if (++attempts === 1) throw new Error('网络连接中断');
    return { ...teamA, ...payload };
  } } });
  page.handleEditTeam();
  page.handleTeamNameInput({ detail: { value: '新的团队名称' } });
  await page.handleSaveTeam();
  assert.equal(page.data.teamEditorOpen, true);
  assert.equal(page.data.teamSaving, false);
  assert.equal(page.data.teamNameDraft, '新的团队名称');
  assert.equal(page.data.teamEditError, '网络连接中断');
  await page.handleSaveTeam();
  assert.equal(attempts, 2);
  assert.equal(page.data.teamEditorOpen, false);
});

test('members cannot open settings or submit a team mutation through handlers', async () => {
  const { page, updates } = mount();
  page.setData({ canManage: false, currentTeam: { ...teamA, role: 'member' } });
  page.handleEditTeam();
  page._editingTeamId = teamA.teamId;
  await page.handleSaveTeam({ detail: { value: { teamName: '越权修改' } } });
  assert.equal(page.data.teamEditorOpen, false);
  assert.equal(updates.length, 0);
});

test('a delayed team save updates its own metadata without selecting it over another team', async () => {
  let finishSave;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const { page } = mount({ api: { updateTeam: () => new Promise((resolve) => { finishSave = resolve; notifyStarted(); }) } });
  page.handleEditTeam();
  const pending = page.handleSaveTeam({ detail: { value: { teamName: '新研发空间' } } });
  await started;
  page.setData({ currentTeam: teamB, teamIndex: 1 });
  finishSave({ ...teamA, name: '新研发空间' });
  await pending;
  assert.equal(page.data.currentTeam.teamId, teamB.teamId);
  assert.equal(page.data.teams[0].name, '新研发空间');
});

test('generated invitation stays visible after refresh and only shares from its own team', async () => {
  const { page } = mount();
  page.handleInvite();
  page.handleInviteRoleChange({ currentTarget: { dataset: { role: 'guest' } } });
  await page.handleGenerateInvite();
  assert.equal(page.data.inviteComposerOpen, false);
  const token = page.data.inviteToken;
  assert.equal(token, 'full-token-with_all-32_characters');
  assert.equal(page.data.inviteRoleLabel, '访客');
  assert.equal(page.data.inviteStatusText, '待领取');
  await page.loadTeams({ silent: true });
  assert.equal(page.data.inviteToken, token);
  assert.equal(page.onShareAppMessage().path, `/pages/home/index?inviteToken=${encodeURIComponent(token)}`);
  page.handleTeamChange({ detail: { value: 1 } });
  assert.equal(page.data.inviteToken, '');
  assert.equal(page.onShareAppMessage().path, '/pages/home/index');
  page.handleTeamChange({ detail: { value: 0 } });
  assert.equal(page.data.inviteToken, token);
});

test('used, revoked and expired invitations are labelled and cannot be shared or copied', async () => {
  for (const [key, value, expected] of [
    ['usedAt', new Date().toISOString(), '已使用'],
    ['revokedAt', new Date().toISOString(), '已撤销'],
    ['expiresAt', '2000-01-01T00:00:00.000Z', '已过期'],
  ]) {
    const { page, copied } = mount();
    await page.handleGenerateInvite();
    page._generatedInvites[teamA.teamId][key] = value;
    assert.equal(page.onShareAppMessage().path, '/pages/home/index');
    await page.handleCopyInvite();
    assert.equal(page.data.inviteStatusText, expected);
    assert.equal(page.data.inviteUsable, false);
    assert.equal(copied.length, 0);
  }
});

test('server invitation status refresh invalidates a previously generated link', async () => {
  const { page, api } = mount();
  await page.handleGenerateInvite();
  api.fetchTeamInvites = async () => [{ id: 'invite-1', role: 'member', usedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }];
  await page.loadTeamData();
  assert.equal(page.data.inviteStatusText, '已使用');
  assert.equal(page.data.inviteUsable, false);
});

test('copy awaits the clipboard helper and exposes a recoverable failure', async () => {
  const { page, copied, clipboard, toasts } = mount();
  await page.handleGenerateInvite();
  await page.handleCopyInvite();
  assert.equal(copied[0].token, page.data.inviteToken);
  assert.equal(copied[0].options.successMessage, '邀请码已复制');
  clipboard.copyText = async () => { throw new Error('微信剪贴板权限未开启'); };
  await page.handleCopyInvite();
  assert.equal(page.data.inviteCopying, false);
  assert.equal(toasts.at(-1).title, '微信剪贴板权限未开启');
});

test('a slow previous-team response cannot overwrite the newly selected team members', async () => {
  let finishPrevious;
  const { page } = mount({ api: {
    fetchTeamMembers: (id) => id === teamA.teamId
      ? new Promise((resolve) => { finishPrevious = resolve; })
      : Promise.resolve([{ userId: 'product-member', role: 'member' }]),
  } });
  const previous = page.loadTeamData();
  page.setData({ currentTeam: teamB, members: [] });
  await page.loadTeamData();
  finishPrevious([{ userId: 'old-team-member', role: 'member' }]);
  await previous;
  assert.equal(page.data.members[0].userId, 'product-member');
});

test('invitation generation failures retain the configuration and allow retry', async () => {
  let attempts = 0;
  const { page, api } = mount();
  const successfulCreate = api.createTeamInvite;
  api.createTeamInvite = async (...args) => {
    if (++attempts === 1) throw new Error('请求超时');
    return successfulCreate(...args);
  };
  page.handleInvite();
  page.handleInviteDurationChange({ currentTarget: { dataset: { hours: 168 } } });
  await page.handleGenerateInvite();
  assert.equal(page.data.inviteComposerOpen, true);
  assert.equal(page.data.inviteError, '请求超时');
  assert.equal(page.data.selectedInviteHours, 168);
  assert.equal(page.data.inviteCreating, false);
  await page.handleGenerateInvite();
  assert.equal(page.data.inviteUsable, true);
});

test('join form keeps rejected invitation editable and paste errors recoverable', async () => {
  const { page, clipboard } = mount({ api: { acceptInvite: async () => { throw new Error('邀请码已过期'); } } });
  page.handleAcceptInvite();
  await page.handlePasteJoin();
  assert.equal(page.data.joinToken, 'pasted-invite-token');
  await page.handleJoinTeam({ detail: { value: { inviteToken: 'pasted-invite-token' } } });
  assert.equal(page.data.joinError, '邀请码已过期');
  assert.equal(page.data.joinOpen, true);
  assert.equal(page.data.joinToken, 'pasted-invite-token');
  assert.equal(page.data.joinLoading, false);
  clipboard.readClipboard = async () => { throw new Error('无法读取剪贴板，请手动粘贴'); };
  await page.handlePasteJoin();
  assert.equal(page.data.joinError, '无法读取剪贴板，请手动粘贴');
  assert.equal(page.data.joinPasting, false);
});

test('switching accounts clears in-memory invitation tokens and sharing state', async () => {
  const { page, app } = mount();
  await page.handleGenerateInvite();
  assert.equal(page.data.inviteUsable, true);
  app.globalData.user = { id: 'another-user' };
  assert.equal(page.onShareAppMessage().path, '/pages/home/index');
  assert.equal(page.data.inviteToken, '');
  assert.equal(Object.keys(page._generatedInvites).length, 0);
  assert.equal(page.data.currentTeam, null);
});

test('an old account invitation response cannot restore its token into a new session', async () => {
  let finishInvite;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const { page, app } = mount({ api: { createTeamInvite: () => new Promise((resolve) => { finishInvite = resolve; notifyStarted(); }) } });
  const pending = page.handleGenerateInvite();
  await started;
  app.globalData.user = { id: 'another-user' };
  page.ensureInviteOwner();
  finishInvite({ id: 'old-invite', token: 'previous-account-token', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  await pending;
  assert.equal(page.data.inviteToken, '');
  assert.equal(Object.keys(page._generatedInvites).length, 0);
  assert.equal(page.data.inviteCreating, false);
});

test('team loading cannot overwrite another account after its response is delayed', async () => {
  let finishTeams;
  const { page, app } = mount({ api: { fetchTeams: () => new Promise((resolve) => { finishTeams = resolve; }) } });
  const pending = page.loadTeams();
  app.globalData.user = { id: 'another-user' };
  app.globalData.teams = [];
  page.ensureInviteOwner();
  finishTeams([teamA]);
  await pending;
  assert.equal(app.globalData.teams.length, 0);
  assert.equal(page.data.teams.length, 0);
});

test('member confirmation keeps the original team when the active team changes', async () => {
  for (const action of ['role', 'remove']) {
    let finishModal;
    const confirmation = new Promise((resolve) => { finishModal = resolve; });
    const requests = [];
    const { page } = mount({
      wx: { showModal: () => confirmation },
      api: {
        updateMemberRole: async (id, userId) => requests.push({ id, userId }),
        removeMember: async (id, userId) => requests.push({ id, userId }),
      },
    });
    const member = { userId: 'member-1', nickname: '队友', role: 'member', teamId: teamA.teamId, teamName: teamA.name };
    const pending = action === 'role' ? page.updateMemberRole(member, 'admin') : page.confirmRemoveMember(member);
    page.setData({ currentTeam: teamB });
    finishModal({ confirm: true });
    await pending;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, teamA.teamId);
    assert.equal(requests[0].userId, 'member-1');
  }
});

test('member confirmation does not mutate a team after the signed-in user changes', async () => {
  let finishModal;
  const confirmation = new Promise((resolve) => { finishModal = resolve; });
  let removals = 0;
  const { page, app } = mount({
    wx: { showModal: () => confirmation },
    api: { removeMember: async () => { removals += 1; } },
  });
  const pending = page.confirmRemoveMember({ userId: 'member-1', teamId: teamA.teamId, teamName: teamA.name });
  app.globalData.user = { id: 'another-user' };
  finishModal({ confirm: true });
  await pending;
  assert.equal(removals, 0);
});
