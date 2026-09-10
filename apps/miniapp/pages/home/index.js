const api = require('../../utils/api');
const { copyText } = require('../../utils/clipboard');
const { submittedNickname, notifyNicknameReview } = require('../../utils/nickname');
const { getThemeData, getActiveThemeColor, applyPageTheme } = require('../../utils/theme');
const {
  KIND_LABELS,
  ROLE_LABELS,
  formatDate,
  friendlyError,
} = require('../../utils/format');

const app = getApp();

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'totp', label: '动态码' },
  { value: 'snippet', label: '代码' },
  { value: 'code', label: '口令' },
  { value: 'secret', label: '密文' },
  { value: 'note', label: '备注' },
];

function defaultProfile() {
  return app.getStoredProfile ? app.getStoredProfile() : {
    nickname: 'CodePool 用户',
    avatarUrl: '/assets/avatar-default.png',
  };
}

Page({
  data: {
    ...getThemeData(),
    loading: true,
    refreshing: false,
    error: '',
    offline: false,
    needsLogin: false,
    loginLoading: false,
    avatarProcessing: false,
    loginProfile: defaultProfile(),
    legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
    teams: [],
    teamIndex: 0,
    currentTeam: null,
    query: '',
    filters: FILTERS,
    activeFilter: 'all',
    accounts: [],
    vaultItems: [],
    visibleAccounts: [],
    visibleVaultItems: [],
    resultCount: 0,
    workspaceName: 'CodePool',
    announcement: '',
    maintenanceMode: false,
  },

  onLoad(options) {
    app.captureInvite(options);
    this._codeRefreshing = {};
    this._hideTimers = {};
    this._networkHandler = ({ isConnected }) => {
      this.setData({ offline: !isConnected });
      if (isConnected && this.data.error) this.initialize({ silent: true });
    };
    wx.onNetworkStatusChange(this._networkHandler);
  },

  async onShow() {
    this._unloaded = false;
    this.syncActiveWorkspace();
    await this.initialize();
  },

  onHide() {
    this.hideAllCodes();
    this.clearTicker();
  },

  onUnload() {
    this._unloaded = true;
    this._loadSequence = (this._loadSequence || 0) + 1;
    this._bootstrapSequence = (this._bootstrapSequence || 0) + 1;
    this._initializeSequence = (this._initializeSequence || 0) + 1;
    this._revealSequence = (this._revealSequence || 0) + 1;
    this.clearTicker();
    this.clearSearchTimer();
    this.clearHideTimers();
    if (this._networkHandler && typeof wx.offNetworkStatusChange === 'function') {
      wx.offNetworkStatusChange(this._networkHandler);
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.initialize({ silent: true, forceConfig: true });
    } finally {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    }
  },

  async initialize(options = {}) {
    const sequence = this._initializeSequence = (this._initializeSequence || 0) + 1;
    const publicConfig = await app.refreshPublicConfig(Boolean(options.forceConfig));
    if (this._unloaded || sequence !== this._initializeSequence) return;
    this.applyPublicConfig(publicConfig);
    const hasSession = await app.awaitReady();
    if (this._unloaded || sequence !== this._initializeSequence) return;
    if (!hasSession) {
      this.clearWorkspaceContent();
      applyPageTheme(this, getActiveThemeColor(app));
      this.clearTicker();
      const loginProfile = defaultProfile();
      this.setData({
        loading: false,
        needsLogin: true,
        error: '',
        accounts: [],
        teams: [],
        currentTeam: null,
        vaultItems: [],
        visibleAccounts: [],
        visibleVaultItems: [],
        loginProfile,
        legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
      });
      return;
    }
    this.syncActiveWorkspace();
    this.setData({ needsLogin: false, offline: !app.globalData.networkConnected });
    await this.bootstrap(options);
  },

  applyPublicConfig(config) {
    const value = config || app.globalData.publicConfig || {};
    this.setData({
      workspaceName: value.workspaceName || 'CodePool',
      announcement: value.announcement || '',
      maintenanceMode: Boolean(value.maintenanceMode),
    });
    wx.setNavigationBarTitle({ title: value.workspaceName || 'CodePool' });
  },

  async bootstrap(options = {}) {
    const sequence = this._bootstrapSequence = (this._bootstrapSequence || 0) + 1;
    const session = app.globalData.token;
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const teams = await api.fetchTeams();
      if (this._unloaded || sequence !== this._bootstrapSequence || session !== app.globalData.token) return;
      app.globalData.teams = teams;
      const activeId = app.globalData.activeTeamId;
      let teamIndex = teams.findIndex((team) => team.teamId === activeId);
      if (teamIndex < 0) teamIndex = 0;
      const currentTeam = teams[teamIndex] || null;
      if ((this.data.currentTeam && this.data.currentTeam.teamId) !== (currentTeam && currentTeam.teamId)) this.clearWorkspaceContent();
      app.setActiveTeam(currentTeam ? currentTeam.teamId : null);
      this.setData({ teams, teamIndex, currentTeam, error: '' });
      applyPageTheme(this, currentTeam ? currentTeam.themeColor : null);
      await this.loadData({ silent: options.silent });
    } catch (error) {
      if (this._unloaded || sequence !== this._bootstrapSequence) return;
      if (this.handleSessionError(error, session) || session !== app.globalData.token) return;
      this.setData({
        loading: false,
        error: friendlyError(error, '代码池加载失败'),
        offline: Boolean(error.offline) || !app.globalData.networkConnected,
      });
    }
  },

  async loadData(options = {}) {
    const team = this.data.teams[this.data.teamIndex];
    const sequence = this._loadSequence = (this._loadSequence || 0) + 1;
    const session = app.globalData.token;
    this.clearTicker();
    this.clearHideTimers();
    if (!team) {
      this.setData({
        loading: false,
        accounts: [],
        vaultItems: [],
        visibleAccounts: [],
        visibleVaultItems: [],
        resultCount: 0,
      });
      return;
    }
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const [accountRows, itemRows] = await Promise.all([
        api.fetchAccounts(team.teamId, this.data.query.trim()),
        api.fetchItems(team.teamId, this.data.query.trim()),
      ]);
      if (!this.isCurrentRequest(sequence, team.teamId, session)) return;
      const accounts = accountRows.map((item) => ({
        ...item,
        kindLabel: KIND_LABELS.totp,
        code: '',
        codeDisplay: '••••••',
        revealed: false,
        codeLoading: false,
        expiresIn: Number(item.period) || 30,
        progress: 100,
      }));
      const vaultItems = itemRows.map((item) => ({
        ...item,
        kindLabel: KIND_LABELS[item.kind] || '共享内容',
        updatedText: formatDate(item.updatedAt),
        expiryText: item.expiresAt ? `有效至 ${formatDate(item.expiresAt)}` : '长期有效',
      }));
      this.setData({ accounts, vaultItems, loading: false, error: '', offline: false });
      this.applyFilter();
    } catch (error) {
      if (sequence === this._loadSequence && this.handleSessionError(error, session)) return;
      if (!this.isCurrentRequest(sequence, team.teamId, session)) return;
      this.setData({
        loading: false,
        error: friendlyError(error, '内容加载失败'),
        offline: Boolean(error.offline),
      });
    }
  },

  handleSessionError(error, session) {
    if (error.code !== 'UNAUTHORIZED' || (app.globalData.token && session !== app.globalData.token)) return false;
    app.logout();
    this.clearWorkspaceContent();
    this.setData({ needsLogin: true, loading: false, teams: [], currentTeam: null });
    applyPageTheme(this, null);
    return true;
  },

  isCurrentRequest(sequence, teamId, session) {
    return !this._unloaded && sequence === this._loadSequence && session === app.globalData.token
      && this.data.currentTeam && this.data.currentTeam.teamId === teamId
      && app.globalData.activeTeamId === teamId;
  },

  clearWorkspaceContent() {
    this._loadSequence = (this._loadSequence || 0) + 1;
    this._revealSequence = (this._revealSequence || 0) + 1;
    this.clearTicker();
    this.clearHideTimers();
    this.clearSearchTimer();
    this._codeRefreshing = {};
    this.setData({ accounts: [], vaultItems: [], visibleAccounts: [], visibleVaultItems: [], resultCount: 0, error: '' });
  },

  syncActiveWorkspace() {
    const activeId = app.globalData.activeTeamId;
    const teams = app.globalData.teams || [];
    const currentTeam = teams.find((team) => team.teamId === activeId) || null;
    if ((this.data.currentTeam && this.data.currentTeam.teamId) !== activeId) {
      this.clearWorkspaceContent();
      this.setData({ query: '', activeFilter: 'all', loading: true });
    }
    if (currentTeam) this.setData({ teams, currentTeam, teamIndex: teams.indexOf(currentTeam) });
    applyPageTheme(this, getActiveThemeColor(app));
  },

  applyFilter() {
    const filter = this.data.activeFilter;
    const visibleAccounts = filter === 'all' || filter === 'totp' ? this.data.accounts : [];
    const visibleVaultItems = filter === 'all'
      ? this.data.vaultItems
      : this.data.vaultItems.filter((item) => item.kind === filter);
    this.setData({
      visibleAccounts,
      visibleVaultItems,
      resultCount: visibleAccounts.length + visibleVaultItems.length,
    });
  },

  handleFilter(e) {
    const { filter } = e.currentTarget.dataset;
    if (!filter || filter === this.data.activeFilter) return;
    this.setData({ activeFilter: filter }, () => this.applyFilter());
  },

  handleTeamChange(e) {
    const teamIndex = Number(e.detail.value);
    const currentTeam = this.data.teams[teamIndex] || null;
    if (!currentTeam || !Number.isInteger(teamIndex)) return;
    this.clearWorkspaceContent();
    app.setActiveTeam(currentTeam.teamId);
    this.setData({ teamIndex, currentTeam, query: '', loading: true });
    applyPageTheme(this, currentTeam.themeColor);
    return this.loadData();
  },

  handleSearchInput(e) {
    this.setData({ query: e.detail.value });
    this.clearSearchTimer();
    this._searchTimer = setTimeout(() => this.loadData({ silent: true }), 450);
  },

  handleSearchConfirm() {
    this.clearSearchTimer();
    this.loadData();
  },

  handleSearchClear() {
    if (!this.data.query) return;
    this.setData({ query: '' }, () => this.loadData());
  },

  clearSearchTimer() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
  },

  async handleLogin(e) {
    if (this.data.loginLoading || this.data.avatarProcessing) return;
    if (!this.data.legalConsent) {
      wx.showToast({ title: '请先勾选同意隐私政策和用户协议', icon: 'none' });
      return;
    }
    this.setData({ loginLoading: true });
    try {
      const nickname = submittedNickname(e);
      app.setStoredProfile({ ...this.data.loginProfile, nickname });
      await app.ensureLogin(true);
      this.setData({ needsLogin: false });
      await this.bootstrap();
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  handleNicknameReview: notifyNicknameReview,

  async storeChosenAvatar(tempFilePath) {
    const avatarUrl = await app.persistAvatarFile(tempFilePath);
    app.setStoredProfile({ avatarUrl, avatar_url: avatarUrl, pendingAvatar: true });
    this.setData({
      'loginProfile.avatarUrl': avatarUrl,
      'loginProfile.avatar_url': avatarUrl,
      'loginProfile.pendingAvatar': true,
    });
  },

  async handleChooseAvatar(e) {
    const tempFilePath = e.detail && e.detail.avatarUrl;
    if (!tempFilePath || this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      await this.storeChosenAvatar(tempFilePath);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '头像选择失败'), icon: 'none' });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },

  async handleChooseAvatarFallback() {
    if (this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      const tempFilePath = await app.chooseAvatarImage();
      if (tempFilePath) await this.storeChosenAvatar(tempFilePath);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '头像选择失败'), icon: 'none' });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },

  handleLegalConsent(e) {
    const accepted = (e.detail.value || []).indexOf('agree') !== -1;
    app.setLegalConsent(accepted);
    this.setData({ legalConsent: accepted });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },

  async handleRevealCode(e) {
    const { id } = e.currentTarget.dataset;
    const existing = this.data.accounts.find((item) => item.id === id);
    if (!existing) return;
    if (existing.revealed) {
      this.hideCode(id);
      return;
    }
    await this.fetchCode(id, true);
  },

  async fetchCode(accountId, userInitiated = false) {
    this._codeRefreshing = this._codeRefreshing || {};
    if (this._codeRefreshing[accountId]) return this._codeRefreshing[accountId];
    const sequence = this._revealSequence || 0;
    const teamId = this.data.currentTeam && this.data.currentTeam.teamId;
    const session = app.globalData.token;
    const isCurrent = () => !this._unloaded && sequence === (this._revealSequence || 0)
      && session === app.globalData.token && app.globalData.activeTeamId === teamId
      && this.data.currentTeam && this.data.currentTeam.teamId === teamId
      && this.data.accounts.some((account) => account.id === accountId);
    this.updateAccount(accountId, { codeLoading: true });
    const pending = api.fetchAccountCode(accountId)
      .then((result) => {
        if (!isCurrent()) return '';
        const total = Number(result.period) || 30;
        const expiresIn = Number(result.expiresIn);
        const safeExpires = Number.isFinite(expiresIn) ? Math.max(0, expiresIn) : total;
        this.updateAccount(accountId, {
          code: result.code,
          codeDisplay: result.code,
          revealed: true,
          codeLoading: false,
          period: total,
          expiresIn: safeExpires,
          progress: total ? Math.round((safeExpires / total) * 100) : 0,
        });
        this.scheduleHide(accountId);
        this.startTicker();
        return result.code;
      })
      .catch((error) => {
        if (!isCurrent()) return '';
        this.updateAccount(accountId, { codeLoading: false });
        if (userInitiated) wx.showToast({ title: friendlyError(error, '验证码获取失败'), icon: 'none' });
        return '';
      })
      .finally(() => {
        if (this._codeRefreshing[accountId] === pending) delete this._codeRefreshing[accountId];
      });
    this._codeRefreshing[accountId] = pending;
    return pending;
  },

  updateAccount(accountId, patch) {
    const accounts = this.data.accounts.map((item) => item.id === accountId ? { ...item, ...patch } : item);
    this.setData({ accounts }, () => this.applyFilter());
  },

  startTicker() {
    if (this._ticker) return;
    this._ticker = setInterval(() => {
      let needsTicker = false;
      const expiredIds = [];
      const accounts = this.data.accounts.map((item) => {
        if (!item.revealed || !item.code) return item;
        needsTicker = true;
        const total = Number(item.period) || 30;
        const remaining = Math.max(0, Number(item.expiresIn) - 1);
        if (remaining <= 0) expiredIds.push(item.id);
        return {
          ...item,
          expiresIn: remaining,
          progress: total ? Math.round((remaining / total) * 100) : 0,
        };
      });
      this.setData({ accounts }, () => this.applyFilter());
      expiredIds.forEach((id) => this.fetchCode(id));
      if (!needsTicker) this.clearTicker();
    }, 1000);
  },

  clearTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  scheduleHide(accountId) {
    if (this._hideTimers[accountId]) clearTimeout(this._hideTimers[accountId]);
    this._hideTimers[accountId] = setTimeout(() => this.hideCode(accountId), 60000);
  },

  clearHideTimers() {
    Object.keys(this._hideTimers || {}).forEach((id) => clearTimeout(this._hideTimers[id]));
    this._hideTimers = {};
  },

  hideCode(accountId) {
    if (this._hideTimers[accountId]) clearTimeout(this._hideTimers[accountId]);
    delete this._hideTimers[accountId];
    this.updateAccount(accountId, { code: '', codeDisplay: '••••••', revealed: false, codeLoading: false });
  },

  hideAllCodes() {
    this._revealSequence = (this._revealSequence || 0) + 1;
    this._codeRefreshing = {};
    this.clearHideTimers();
    const accounts = this.data.accounts.map((item) => ({
      ...item,
      code: '',
      codeDisplay: '••••••',
      revealed: false,
      codeLoading: false,
    }));
    this.setData({ accounts }, () => this.applyFilter());
  },

  async handleCopyCode(e) {
    const { id } = e.currentTarget.dataset;
    const account = this.data.accounts.find((item) => item.id === id);
    if (!account) return;
    const teamId = this.data.currentTeam && this.data.currentTeam.teamId;
    const sequence = this._revealSequence || 0;
    const session = app.globalData.token;
    const isCurrent = () => !this._unloaded && sequence === (this._revealSequence || 0)
      && session === app.globalData.token && app.globalData.activeTeamId === teamId
      && this.data.currentTeam && this.data.currentTeam.teamId === teamId;
    const code = account.code || await this.fetchCode(id, true);
    if (code && isCurrent()) {
      try { await copyText(code, { successMessage: '动态码已复制', isCurrent }); }
      catch (error) { wx.showToast({ title: friendlyError(error, '复制失败'), icon: 'none' }); }
    }
  },

  goAccountDetail(e) {
    wx.navigateTo({ url: `/pages/account/detail?id=${e.currentTarget.dataset.id}` });
  },

  goItemDetail(e) {
    wx.navigateTo({ url: `/pages/item/detail/index?id=${e.currentTarget.dataset.id}` });
  },

  goTeam() {
    wx.switchTab({ url: '/pages/team/index' });
  },

  async handleAdd() {
    if (!await app.guardMaintenance('新增内容')) {
      this.applyPublicConfig(app.globalData.publicConfig);
      return;
    }
    if (!this.data.teams.length) {
      wx.showModal({
        title: '先创建团队',
        content: '内容需要归属一个团队代码池。',
        confirmText: '去创建',
        success: (res) => { if (res.confirm) this.goTeam(); },
      });
      return;
    }
    const role = this.data.currentTeam && this.data.currentTeam.role;
    if (role === 'guest') {
      wx.showToast({ title: '访客为只读权限，请联系管理员', icon: 'none' });
      return;
    }
    if (role === 'member') {
      wx.navigateTo({ url: '/pages/item/add/index' });
      return;
    }
    wx.showActionSheet({
      itemList: ['添加共享内容', '添加动态验证码', '扫描动态码二维码'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) wx.navigateTo({ url: '/pages/item/add/index' });
        if (tapIndex === 1) wx.navigateTo({ url: '/pages/account/add/index' });
        if (tapIndex === 2) this.handleQuickScan();
      },
    });
  },

  async handleQuickScan() {
    if (!await app.guardMaintenance('扫码导入')) {
      this.applyPublicConfig(app.globalData.publicConfig);
      return;
    }
    const team = this.data.currentTeam;
    if (!team) return;
    if (team.role !== 'owner' && team.role !== 'admin') {
      wx.showToast({ title: '仅所有者和管理员可添加动态码', icon: 'none' });
      return;
    }
    try {
      const scan = await wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] });
      if (!scan.result || scan.result.indexOf('otpauth://totp/') !== 0) {
        wx.showToast({ title: '请选择有效的动态码二维码', icon: 'none' });
        return;
      }
      const confirm = await wx.showModal({
        title: '确认导入动态码',
        content: `将动态验证码添加到「${team.name}」。二维码密钥不会在页面中展示。`,
        confirmText: '安全导入',
      });
      if (!confirm.confirm) return;
      wx.showLoading({ title: '导入中', mask: true });
      await api.createAccount({ team_id: team.teamId, otpauth_url: scan.result });
      wx.showToast({ title: '导入成功', icon: 'success' });
      await this.loadData({ silent: true });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: friendlyError(error, '导入失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleRetry() {
    this.initialize({ forceConfig: true });
  },

  onShareAppMessage() {
    return {
      title: 'CodePool · 团队安全代码池',
      path: '/pages/home/index',
    };
  },
});
