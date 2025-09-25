const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    loading: true,
    accounts: [],
    query: '',
    teams: [],
    teamIndex: 0,
    ticker: null,
    needsLogin: false,
    loginLoading: false,
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    this.clearTicker();
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      this.setData({ needsLogin: true, loading: false, accounts: [] });
      return;
    }
    this.setData({ needsLogin: false });
    await this.bootstrap();
  },

  async bootstrap() {
    try {
      const { teams, activeTeamId } = app.globalData;
      const teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === activeTeamId));
      this.setData({ teams, teamIndex: teamIndex === -1 ? 0 : teamIndex });
      await this.loadAccounts();
      this.startTicker();
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(error);
    }
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      this.setData({ needsLogin: false });
      await this.bootstrap();
    } catch (error) {
      console.error('login failed', error);
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async onPullDownRefresh() {
    await this.initialize();
    wx.stopPullDownRefresh();
  },

  onHide() {
    this.clearTicker();
  },

  onUnload() {
    this.clearTicker();
  },

  clearTicker() {
    if (this.data.ticker) {
      clearInterval(this.data.ticker);
      this.data.ticker = null;
    }
  },

  startTicker() {
    this.clearTicker();
    if (!this.data.accounts.length) return;
    const ticker = setInterval(() => {
      const accounts = this.data.accounts.map((item) => {
        if (!item.code) {
          return item;
        }
        const remaining = item.expiresIn - 1;
        if (remaining <= 0) {
          this.fetchCode(item.id);
          return { ...item, expiresIn: item.period, progress: 0 };
        }
        const progress = Math.floor(((item.period - remaining) / item.period) * 100);
        return { ...item, expiresIn: remaining, progress };
      });
      this.setData({ accounts });
    }, 1000);
    this.data.ticker = ticker;
  },

  async loadAccounts() {
    if (this.data.needsLogin) {
      this.setData({ loading: false, accounts: [] });
      return;
    }
    this.setData({ loading: true });
    const team = this.data.teams[this.data.teamIndex];
    if (!team) {
      this.setData({ accounts: [], loading: false });
      return;
    }
    try {
      const res = await api.fetchAccounts(team.teamId, this.data.query);
      const list = Array.isArray(res) ? res : (res.items || []);
      const accounts = list.map((item) => ({
        id: item.id,
        issuer: item.issuer,
        label: item.label,
        accountIdentifier: item.accountIdentifier,
        code: '',
        expiresIn: item.period,
        period: item.period,
        progress: 0,
      }));
      this.setData({ accounts, loading: false });
      accounts.forEach((account) => this.fetchCode(account.id));
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async fetchCode(accountId) {
    try {
      const res = await api.fetchAccountCode(accountId);
      const accounts = this.data.accounts.map((item) => {
        if (item.id !== accountId) return item;
        const progress = Math.floor(((item.period - res.expiresIn) / item.period) * 100);
        return { ...item, code: res.code, expiresIn: res.expiresIn, period: res.period, progress };
      });
      this.setData({ accounts });
    } catch (error) {
      console.error('code error', error);
    }
  },

  handleTeamChange(e) {
    const index = Number(e.detail.value);
    this.setData({ teamIndex: index }, () => {
      const team = this.data.teams[index];
      if (team) {
        app.setActiveTeam(team.teamId);
        this.loadAccounts();
      }
    });
  },

  handleSearchInput(e) {
    this.setData({ query: e.detail.value });
  },

  handleSearchConfirm() {
    this.loadAccounts();
  },

  handleRefresh() {
    this.loadAccounts();
  },

  goAccountDetail(e) {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/account/detail?id=${id}` });
  },

  handleAddAccount() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/account/add/index' });
  },

  async handleQuickScan() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const team = this.data.teams[this.data.teamIndex];
    if (!team) {
      wx.showToast({ title: '请选择团队', icon: 'none' });
      return;
    }
    try {
      const { result } = await wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] });
      if (!result || result.indexOf('otpauth://') !== 0) {
        wx.showToast({ title: '二维码无效', icon: 'none' });
        return;
      }
      await api.createAccount({ team_id: team.teamId, otpauth_url: result });
      wx.showToast({ title: '导入成功' });
      await app.tryRestoreSession();
      await this.bootstrap();
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return;
      console.error('scan add error', error);
      wx.showToast({ title: '导入失败', icon: 'none' });
    }
  },
});
