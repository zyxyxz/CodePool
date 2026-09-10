const api = require('../../utils/api');
const { getThemeData, getActiveThemeColor, applyPageTheme } = require('../../utils/theme');
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
    ...getThemeData(),
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
    const teams = app.globalData.teams || [];
    const teamIndex = teams.findIndex((entry) => entry.teamId === app.globalData.activeTeamId);
    const team = teams[teamIndex];
    if (!team || !this.data.currentTeam || team.teamId !== this.data.currentTeam.teamId) {
      this._logsSequence = (this._logsSequence || 0) + 1;
      this.setData({ teams, teamIndex: Math.max(0, teamIndex), logs: [], visibleLogs: [], currentTeam: team || null, loading: true });
    }
    applyPageTheme(this, getActiveThemeColor(app));
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
    const sequence = this._initializeSequence = (this._initializeSequence || 0) + 1;
    const hasSession = await app.awaitReady();
    if (sequence !== this._initializeSequence) return;
    if (!hasSession) {
      this.setData({ loading: false, needsLogin: true, logs: [], visibleLogs: [], error: '' });
      return;
    }
    this.setData({ needsLogin: false });
    const session = app.globalData.token;
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const teams = await api.fetchTeams();
      if (sequence !== this._initializeSequence || session !== app.globalData.token) return;
      app.globalData.teams = teams;
      let teamIndex = teams.findIndex((team) => team.teamId === app.globalData.activeTeamId);
      if (teamIndex < 0) teamIndex = 0;
      const currentTeam = teams[teamIndex] || null;
      app.setActiveTeam(currentTeam ? currentTeam.teamId : null);
      this.setData({ teams, teamIndex, currentTeam });
      applyPageTheme(this, currentTeam ? currentTeam.themeColor : null);
      await this.loadLogs();
    } catch (error) {
      if (sequence !== this._initializeSequence || (app.globalData.token && session !== app.globalData.token)) return;
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
        this.setData({ loading: false, needsLogin: true, teams: [], currentTeam: null, logs: [], visibleLogs: [] });
        applyPageTheme(this, null);
        return;
      }
      if (session !== app.globalData.token) return;
      this.setData({ loading: false, error: friendlyError(error, '审计日志加载失败'), offline: Boolean(error.offline) });
    }
  },

  async loadLogs() {
    const team = this.data.currentTeam;
    const sequence = this._logsSequence = (this._logsSequence || 0) + 1;
    const session = app.globalData.token;
    const isCurrent = () => sequence === this._logsSequence && session === app.globalData.token
      && this.data.currentTeam && this.data.currentTeam.teamId === team.teamId
      && app.globalData.activeTeamId === team.teamId;
    if (!team) {
      this.setData({ loading: false, logs: [], visibleLogs: [] });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const rows = await api.fetchLogs(team.teamId, 200);
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
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
    if (!currentTeam || !Number.isInteger(teamIndex)) return;
    this.setData({ teamIndex, currentTeam, activeFilter: 'all', logs: [], visibleLogs: [] }, () => {
      if (currentTeam) app.setActiveTeam(currentTeam.teamId);
      applyPageTheme(this, currentTeam.themeColor);
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
