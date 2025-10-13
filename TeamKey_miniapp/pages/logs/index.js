const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    logs: [],
    teams: [],
    teamIndex: 0,
    loading: true,
    needsLogin: false,
    loginLoading: false,
    loginProfile: app.getStoredProfile ? app.getStoredProfile() : {
      nickname: 'TeamKey 用户',
      avatarUrl: '/assets/avatar-default.png',
    },
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      const profile = this.prepareLoginProfile();
      this.setData({ needsLogin: true, loading: false, logs: [], loginProfile: profile });
      return;
    }
    this.setData({ needsLogin: false });
    let teams = [];
    if (app.globalData.token) {
      try {
        teams = await api.fetchTeams();
        app.globalData.teams = teams;
      } catch (error) {
        console.error('fetch teams failed', error);
        teams = app.globalData.teams || [];
      }
    }
    const activeTeamId = app.globalData.activeTeamId || (teams[0] ? teams[0].teamId : null);
    const teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === activeTeamId));
    if (teams[teamIndex]) {
      app.setActiveTeam(teams[teamIndex].teamId);
    }
    this.setData({ teams, teamIndex: teamIndex === -1 ? 0 : teamIndex });
    await this.loadLogs();
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      app.setStoredProfile(this.data.loginProfile);
      await app.ensureLogin(true);
      this.setData({ needsLogin: false });
      await this.initialize();
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
      console.error(error);
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async loadLogs() {
    const team = this.data.teams[this.data.teamIndex];
    this.setData({ loading: true });
    try {
      const res = await api.fetchLogs(team ? team.teamId : undefined);
      const items = (res.items || []).map((item) => ({
        id: item.id,
        action: item.action,
        createdAt: item.created_at || item.createdAt,
        targetType: item.target_type || item.targetType,
        targetId: item.target_id || item.targetId,
        user: item.user || null,
      }));
      this.setData({ logs: items, loading: false });
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  handleTeamChange(e) {
    const teamIndex = Number(e.detail.value);
    this.setData({ teamIndex }, () => {
      const team = this.data.teams[teamIndex];
      if (team) app.setActiveTeam(team.teamId);
      this.loadLogs();
    });
  },

  onPullDownRefresh() {
    this.initialize().finally(() => wx.stopPullDownRefresh());
  },

  prepareLoginProfile() {
    if (typeof app.getStoredProfile === 'function') {
      const profile = app.getStoredProfile();
      this.setData({ loginProfile: profile });
      return profile;
    }
    const fallback = { nickname: 'TeamKey 用户', avatarUrl: '/assets/avatar-default.png' };
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
});
