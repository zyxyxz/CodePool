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
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      this.setData({ needsLogin: true, loading: false, logs: [] });
      return;
    }
    this.setData({ needsLogin: false });
    const teams = app.globalData.teams || [];
    const teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === app.globalData.activeTeamId));
    this.setData({ teams, teamIndex: teamIndex === -1 ? 0 : teamIndex });
    await this.loadLogs();
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
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
});
