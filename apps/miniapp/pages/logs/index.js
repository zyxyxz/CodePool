const api = require('../../utils/api');
const {
  ACTION_LABELS,
  KIND_LABELS,
  formatDate,
  formatRelative,
  friendlyError,
} = require('../../utils/format');

const app = getApp();

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'content', label: '内容' },
  { value: 'share', label: '分享' },
  { value: 'member', label: '成员' },
  { value: 'auth', label: '登录' },
];

function actionCategory(action) {
  if (action.indexOf('SHARE_') === 0) return 'share';
  if (action.indexOf('MEMBER_') === 0 || action.indexOf('INVITE_') === 0 || action.indexOf('TEAM_') === 0) return 'member';
  if (action.indexOf('AUTH_') === 0) return 'auth';
  return 'content';
}

Page({
  data: {
    loading: true,
    error: '',
    offline: false,
    needsLogin: false,
    teams: [],
    teamIndex: 0,
    currentTeam: null,
    filters: FILTERS,
    activeFilter: 'all',
    logs: [],
    visibleLogs: [],
  },

  async onShow() {
    await this.initialize();
  },

  async onPullDownRefresh() {
    try {
      await this.initialize({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initialize(options = {}) {
    const hasSession = await app.awaitReady();
    if (!hasSession) {
      this.setData({ loading: false, needsLogin: true, logs: [], visibleLogs: [], error: '' });
      return;
    }
    this.setData({ needsLogin: false });
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const teams = await api.fetchTeams();
      let teamIndex = teams.findIndex((team) => team.teamId === app.globalData.activeTeamId);
      if (teamIndex < 0) teamIndex = 0;
      const currentTeam = teams[teamIndex] || null;
      if (currentTeam) app.setActiveTeam(currentTeam.teamId);
      this.setData({ teams, teamIndex, currentTeam });
      await this.loadLogs();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
        this.setData({ loading: false, needsLogin: true });
        return;
      }
      this.setData({ loading: false, error: friendlyError(error, '审计日志加载失败'), offline: Boolean(error.offline) });
    }
  },

  async loadLogs() {
    const team = this.data.currentTeam;
    if (!team) {
      this.setData({ loading: false, logs: [], visibleLogs: [] });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const rows = await api.fetchLogs(team.teamId, 200);
      const logs = rows.map((log) => {
        const action = log.action || 'UNKNOWN';
        const targetType = log.targetType || log.target_type || '';
        const actorName = log.actorName || (log.user && log.user.nickname) || '系统';
        return {
          ...log,
          action,
          actionLabel: ACTION_LABELS[action] || action,
          category: actionCategory(action),
          actorName,
          actorAvatar: log.actorAvatar || '/assets/avatar-default.png',
          createdText: formatDate(log.createdAt || log.created_at, true),
          relativeText: formatRelative(log.createdAt || log.created_at),
          targetText: KIND_LABELS[targetType] || (targetType === 'user' ? '成员' : targetType === 'team' ? '团队' : targetType === 'invite' ? '邀请' : '系统对象'),
        };
      });
      this.setData({ logs, loading: false, error: '', offline: false }, () => this.applyFilter());
    } catch (error) {
      this.setData({ loading: false, error: friendlyError(error, '日志读取失败'), offline: Boolean(error.offline) });
    }
  },

  applyFilter() {
    const active = this.data.activeFilter;
    this.setData({ visibleLogs: active === 'all' ? this.data.logs : this.data.logs.filter((log) => log.category === active) });
  },

  handleFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ activeFilter: filter }, () => this.applyFilter());
  },

  handleTeamChange(e) {
    const teamIndex = Number(e.detail.value);
    const currentTeam = this.data.teams[teamIndex] || null;
    this.setData({ teamIndex, currentTeam, activeFilter: 'all' }, () => {
      if (currentTeam) app.setActiveTeam(currentTeam.teamId);
      this.loadLogs();
    });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  handleRetry() {
    this.initialize();
  },
});
