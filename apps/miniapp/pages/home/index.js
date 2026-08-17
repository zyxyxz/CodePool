const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    loading: true,
    accounts: [],
    vaultItems: [],
    query: '',
    teams: [],
    teamIndex: 0,
    ticker: null,
    needsLogin: false,
    loginLoading: false,
    loginProfile: app.getStoredProfile ? app.getStoredProfile() : {
      nickname: 'CodePool 用户',
      avatarUrl: '/assets/avatar-default.png',
    },
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    this.clearTicker();
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      const profile = this.prepareLoginProfile();
      this.setData({ needsLogin: true, loading: false, accounts: [], vaultItems: [], loginProfile: profile });
      return;
    }
    this.setData({ needsLogin: false });
    await this.bootstrap();
  },

  async bootstrap() {
    try {
      let teams = [];
      if (app.globalData.token) {
        teams = await api.fetchTeams();
        app.globalData.teams = teams;
      }
      const activeTeamId = app.globalData.activeTeamId || (teams[0] ? teams[0].teamId : null);
      let teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === activeTeamId));
      if (teamIndex === -1) {
        teamIndex = 0;
      }
      if (teams[teamIndex] && teams[teamIndex].teamId) {
        app.setActiveTeam(teams[teamIndex].teamId);
      }
      this.setData({
        teams,
        teamIndex: teams.length ? teamIndex : 0,
      });
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
      app.setStoredProfile(this.data.loginProfile);
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

  prepareLoginProfile() {
    if (typeof app.getStoredProfile === 'function') {
      const profile = app.getStoredProfile();
      this.setData({ loginProfile: profile });
      return profile;
    }
    const fallback = { nickname: 'CodePool 用户', avatarUrl: '/assets/avatar-default.png' };
    this.setData({ loginProfile: fallback });
    return fallback;
  },

  async handleChooseProfile() {
    try {
      const res = await wx.getUserProfile({ desc: '用于完善账号资料' });
      const profile = app.setStoredProfile({
        nickname: res.userInfo.nickName,
        avatarUrl: res.userInfo.avatarUrl,
        avatar_url: res.userInfo.avatarUrl,
      });
      this.setData({ loginProfile: profile });
      wx.showToast({ title: '已更新头像昵称', icon: 'none' });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
        wx.showToast({ title: '已取消授权', icon: 'none' });
      } else {
        wx.showToast({ title: '获取信息失败', icon: 'none' });
        console.error('profile choose failed', error);
      }
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
        const total = Number(item.period) || 30;
        const remaining = Number(item.expiresIn) - 1;
        if (remaining <= 0) {
          this.fetchCode(item.id);
          return { ...item, expiresIn: total, period: total, progress: 0 };
        }
        const safeRemaining = remaining < 0 ? 0 : remaining;
        const progress = total ? Math.floor(((total - safeRemaining) / total) * 100) : 0;
        return { ...item, expiresIn: safeRemaining, progress };
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
      this.setData({ accounts: [], vaultItems: [], loading: false });
      return;
    }
    try {
      const [res, vaultItems] = await Promise.all([
        api.fetchAccounts(team.teamId, this.data.query),
        api.fetchItems(team.teamId, this.data.query),
      ]);
      const list = Array.isArray(res) ? res : [];
      const accounts = list.map((item) => {
        const period = Number(item.period) || 30;
        return {
          id: item.id,
          issuer: item.issuer,
          label: item.label,
          accountIdentifier: item.accountIdentifier,
          remark: item.remark,
          code: '',
          expiresIn: period,
          period,
          progress: 0,
        };
      });
      this.setData({ accounts, vaultItems, loading: false });
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
        const total = Number(res.period) || Number(item.period) || 30;
        const expiresIn = Number(res.expiresIn);
        const safeExpires = Number.isFinite(expiresIn) && expiresIn >= 0 ? expiresIn : total;
        const progress = total ? Math.floor(((total - safeExpires) / total) * 100) : 0;
        return { ...item, code: res.code, expiresIn: safeExpires, period: total, progress };
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

  handleAddContent() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/item/add/index' });
  },

  goItemDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/item/detail/index?id=${id}` });
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
