const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const format = require('../utils/format');

function setup(api = {}, wxOverrides = {}) {
  let definition;
  const toasts = [];
  const app = {
    globalData: { teams: [], user: { id: 'me' } },
    guardMaintenance: async () => true,
    setActiveTeam(id) { this.globalData.activeTeamId = id; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/account/detail.js'), 'utf8'), {
    getApp: () => app,
    Page(value) { definition = value; },
    require(name) { return name.endsWith('/api') ? api : name.endsWith('/clipboard') ? { copyText: async () => {} } : format; },
    wx: { showModal: async () => ({ confirm: true }), showToast: (value) => toasts.push(value), setNavigationBarTitle() {}, ...wxOverrides },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(updates) {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.split('.');
      if (parts.length === 1) this.data[key] = value;
      else this.data[parts[0]][parts[1]] = value;
    }
  } };
  page.setData({ accountId: 'key', loading: false, account: { id: 'key', teamId: 'source', canManage: true, issuer: 'Test', label: 'Account' } });
  return { page, app, toasts };
}

test('transfer lists all eligible teams, excludes current/read-only teams and supports searching beyond six rows', async () => {
  const teams = [{ teamId: 'source', name: 'Source', role: 'owner' }, { teamId: 'read-only', name: 'Guest', role: 'guest' }, { teamId: 'member', name: 'Member', role: 'member' },
    ...Array.from({ length: 12 }, (_, index) => ({ teamId: `target-${index}`, name: `Target ${index}`, role: 'admin' }))];
  const { page } = setup({ fetchTeams: async () => teams });
  await page.handleTransfer();
  assert.equal(page.data.transferTeams.length, 12);
  page.handleTransferSearch({ detail: { value: 'Target 11' } });
  assert.equal(page.data.visibleTransferTeams.length, 1);
  assert.equal(page.data.visibleTransferTeams[0].teamId, 'target-11');
});

test('team fetch failure is shown as an error, and closing discards a delayed list response', async () => {
  const { page } = setup({ fetchTeams: async () => { throw new Error('网络不可用'); } });
  await page.handleTransfer();
  assert.equal(page.data.transferError, '网络不可用');
  let resolve;
  const delayed = setup({ fetchTeams: () => new Promise((done) => { resolve = done; }) }).page;
  const operation = delayed.handleTransfer();
  await new Promise(setImmediate);
  delayed.closeTransfer();
  resolve([{ teamId: 'source', name: 'Source', role: 'owner' }, { teamId: 'late', name: 'Late', role: 'owner' }]);
  await operation;
  assert.equal(delayed.data.transferOpen, false);
  assert.equal(delayed.data.transferTeams.length, 0);
});

test('successful transfer sends the original source guard, clears revealed code and share token and switches team', async () => {
  let body;
  const account = { id: 'key', teamId: 'target', issuer: 'Issuer', label: 'Account', period: 30 };
  const { page, app, toasts } = setup({
    transferAccount: async (...args) => { body = args; return { account, revokedShareCount: 1 }; },
    fetchAccountDetail: async () => account,
    fetchShares: async () => [],
  });
  app.globalData.teams = [{ teamId: 'target', role: 'admin', name: 'Target' }];
  page.setData({ transferOpen: true, transferTeams: app.globalData.teams, targetTeamId: 'target', code: '123456', codeVisible: true, shareToken: 'old-share' });
  await page.confirmTransfer();
  assert.deepEqual(body, ['key', 'source', 'target']);
  assert.equal(page.data.code, '');
  assert.equal(page.data.shareToken, '');
  assert.equal(page.data.account.teamId, 'target');
  assert.equal(app.globalData.activeTeamId, 'target');
  assert.equal(page.data.transferOpen, false);
  assert.equal(toasts.at(-1).title, '已转移到目标团队');
});

test('cancelled confirmation does not transfer; rejected transfer stays in the picker with an inline error', async () => {
  let writes = 0;
  const api = { transferAccount: async () => { writes += 1; throw new Error('目标团队数量已达上限'); } };
  const cancelled = setup(api, { showModal: async () => ({ confirm: false }) }).page;
  cancelled.setData({ transferOpen: true, transferTeams: [{ teamId: 'target', name: 'Target' }], targetTeamId: 'target' });
  await cancelled.confirmTransfer();
  assert.equal(writes, 0);
  const page = setup(api).page;
  page.setData({ transferOpen: true, transferTeams: [{ teamId: 'target', name: 'Target' }], targetTeamId: 'target' });
  await page.confirmTransfer();
  assert.equal(page.data.transferOpen, true);
  assert.equal(page.data.account.teamId, 'source');
  assert.equal(page.data.transferError, '目标团队数量已达上限');
  assert.equal(page.data.transferring, false);
});

test('a code request finishing after opening transfer cannot redisplay sensitive code', async () => {
  let resolve;
  const { page } = setup({ fetchAccountCode: () => new Promise((done) => { resolve = done; }), fetchTeams: async () => [{ teamId: 'source', name: 'Source', role: 'owner' }] });
  const pendingCode = page.fetchCode(true);
  await page.handleTransfer();
  resolve({ code: '123456', period: 30, expiresIn: 30 });
  assert.equal(await pendingCode, '');
  assert.equal(page.data.codeVisible, false);
  assert.equal(page.data.codeDisplay, '••••••');
});

test('an older detail response cannot undo the visible destination after transfer', async () => {
  let resolveOld;
  let calls = 0;
  const destination = { id: 'key', teamId: 'target', issuer: 'New', period: 30 };
  const { page, app } = setup({
    fetchAccountDetail: () => ++calls === 1 ? new Promise((done) => { resolveOld = done; }) : Promise.resolve(destination),
    transferAccount: async () => ({ account: destination, revokedShareCount: 0 }),
    fetchShares: async () => [],
  });
  app.globalData.teams = [{ teamId: 'target', name: 'Target', role: 'owner' }];
  const oldLoad = page.loadAccount();
  page.setData({ transferOpen: true, transferTeams: app.globalData.teams, targetTeamId: 'target' });
  await page.confirmTransfer();
  resolveOld({ id: 'key', teamId: 'source', issuer: 'Old' });
  await oldLoad;
  assert.equal(page.data.account.teamId, 'target');
  assert.equal(page.data.account.issuer, 'New');
  assert.equal(page.data.loading, false);
});
