const api = require('../../utils/api');
const { copyText } = require('../../utils/clipboard');
const {
  formatDate,
  friendlyError,
  isExpired,
} = require('../../utils/format');

const app = getApp();

Page({
  data: {
    accountId: '',
    account: null,
    loading: true,
    error: '',
    offline: false,
    code: '',
    codeDisplay: '••••••',
    codeVisible: false,
    codeLoading: false,
    expiresIn: 0,
    period: 30,
    progress: 100,
    shares: [],
    sharesLoading: false,
    sharing: false,
    shareToken: '',
    shareExpiresText: '',
    transferOpen: false,
    transferLoading: false,
    transferring: false,
    deleting: false,
    transferError: '',
    transferQuery: '',
    transferTeams: [],
    visibleTransferTeams: [],
    targetTeamId: '',
  },

  onLoad(options) {
    this.setData({ accountId: options.id || '' });
  },

  async onShow() {
    const hasSession = await app.awaitReady();
    if (!hasSession) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    if (!this.data.transferOpen && !this.data.transferring && !this.data.deleting) await this.loadAccount();
  },

  onHide() {
    this.hideCode();
  },

  onUnload() {
    this._unloaded = true;
    this._accountRequestVersion = (this._accountRequestVersion || 0) + 1;
    this._transferListVersion = (this._transferListVersion || 0) + 1;
    this.hideCode();
  },

  async onPullDownRefresh() {
    try {
      if (!this.data.transferOpen && !this.data.transferring && !this.data.deleting) await this.loadAccount();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadAccount() {
    if (!this.data.accountId) {
      this.setData({ loading: false, error: '缺少动态码标识' });
      return;
    }
    this.hideCode();
    const requestVersion = this._accountRequestVersion = (this._accountRequestVersion || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.fetchAccountDetail(this.data.accountId);
      if (this._unloaded || requestVersion !== this._accountRequestVersion) return;
      const account = {
        ...result,
        createdText: formatDate(result.createdAt, true),
        updatedText: formatDate(result.updatedAt, true),
      };
      const team = app.globalData.teams.find((entry) => entry.teamId === account.teamId);
      const role = team ? team.role : 'guest';
      account.teamName = team ? team.name : '所属团队';
      account.canManage = role === 'owner' || role === 'admin';
      account.canShare = account.canManage || role === 'member';
      this.setData({
        account,
        loading: false,
        error: '',
        offline: false,
        period: Number(account.period) || 30,
        expiresIn: Number(account.period) || 30,
        progress: 100,
      });
      wx.setNavigationBarTitle({ title: account.issuer || '动态验证码' });
      await this.loadShares();
    } catch (error) {
      if (this._unloaded || requestVersion !== this._accountRequestVersion) return;
      this.setData({
        loading: false,
        error: friendlyError(error, '动态验证码不存在或无权访问'),
        offline: Boolean(error.offline),
      });
    }
  },

  async loadShares() {
    const requestVersion = this._sharesRequestVersion = (this._sharesRequestVersion || 0) + 1;
    this.setData({ sharesLoading: true });
    try {
      const rows = await api.fetchShares(this.data.accountId);
      if (this._unloaded || requestVersion !== this._sharesRequestVersion) return;
      const currentUserId = app.globalData.user && app.globalData.user.id;
      const elevated = Boolean(this.data.account && this.data.account.canManage);
      const shares = rows.map((share) => {
        const expired = isExpired(share.expiresAt);
        const consumed = Number(share.viewCount || 0) >= Number(share.maxViews || 1);
        return {
          ...share,
          expiresText: formatDate(share.expiresAt),
          statusText: share.revokedAt ? '已撤销' : expired ? '已过期' : consumed ? '已领完' : '可领取',
          active: !share.revokedAt && !expired && !consumed,
          viewsText: `${Number(share.viewCount || 0)} / ${Number(share.maxViews || 1)}`,
          canRevoke: Boolean(share.canRevoke || elevated || (share.createdBy && share.createdBy === currentUserId)),
        };
      });
      this.setData({ shares });
    } catch (error) {
      if (!this._unloaded && requestVersion === this._sharesRequestVersion) this.setData({ shares: [] });
    } finally {
      if (!this._unloaded && requestVersion === this._sharesRequestVersion) this.setData({ sharesLoading: false });
    }
  },

  async handleToggleCode() {
    if (this.data.codeVisible) {
      this.hideCode();
      return;
    }
    await this.fetchCode(true);
  },

  async fetchCode(userInitiated = false) {
    if (this.data.transferOpen || this.data.transferring || this.data.deleting || this._unloaded) return '';
    if (this._fetchingCode) return this._fetchingCode;
    const visibilityVersion = this._codeVisibilityVersion || 0;
    this.setData({ codeLoading: true });
    this._fetchingCode = api.fetchAccountCode(this.data.accountId)
      .then((result) => {
        if (this._unloaded || visibilityVersion !== (this._codeVisibilityVersion || 0)) return '';
        const total = Number(result.period) || this.data.period || 30;
        const expiresIn = Number(result.expiresIn);
        const safeExpires = Number.isFinite(expiresIn) ? Math.max(0, expiresIn) : total;
        this.setData({
          code: result.code,
          codeDisplay: result.code,
          codeVisible: true,
          codeLoading: false,
          period: total,
          expiresIn: safeExpires,
          progress: total ? Math.round((safeExpires / total) * 100) : 0,
        });
        this.startTicker();
        this.scheduleHide();
        return result.code;
      })
      .catch((error) => {
        if (this._unloaded || visibilityVersion !== (this._codeVisibilityVersion || 0)) return '';
        this.setData({ codeLoading: false });
        if (userInitiated) wx.showToast({ title: friendlyError(error, '动态码获取失败'), icon: 'none' });
        return '';
      })
      .finally(() => {
        this._fetchingCode = null;
      });
    return this._fetchingCode;
  },

  startTicker() {
    this.clearTicker();
    this._ticker = setInterval(() => {
      if (!this.data.codeVisible) {
        this.clearTicker();
        return;
      }
      const total = Number(this.data.period) || 30;
      const remaining = Math.max(0, Number(this.data.expiresIn) - 1);
      this.setData({
        expiresIn: remaining,
        progress: total ? Math.round((remaining / total) * 100) : 0,
      });
      if (remaining <= 0) this.fetchCode();
    }, 1000);
  },

  clearTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  scheduleHide() {
    this.clearHideTimer();
    this._hideTimer = setTimeout(() => this.hideCode(), 60000);
  },

  clearHideTimer() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
  },

  hideCode() {
    this._codeVisibilityVersion = (this._codeVisibilityVersion || 0) + 1;
    this.clearTicker();
    this.clearHideTimer();
    if (!this._unloaded && (this.data.codeVisible || this.data.code || this.data.codeLoading)) {
      this.setData({
        code: '',
        codeDisplay: '••••••',
        codeVisible: false,
        codeLoading: false,
        expiresIn: this.data.period,
        progress: 100,
      });
    }
  },

  async handleCopy() {
    const code = this.data.code || await this.fetchCode(true);
    if (!code) return;
    const confirm = await wx.showModal({
      title: '复制动态验证码？',
      content: `验证码将在约 ${this.data.expiresIn} 秒后失效。复制后请仅粘贴到可信页面。`,
      confirmText: '复制',
      confirmColor: '#15803D',
    });
    if (confirm.confirm) {
      try { await copyText(code, { successMessage: '动态码已复制' }); }
      catch (error) { wx.showToast({ title: friendlyError(error, '复制失败'), icon: 'none' }); }
    }
  },

  handleEdit() {
    if (!this.data.account || !this.data.account.canManage || this.data.transferring || this.data.deleting) return;
    wx.navigateTo({ url: `/pages/account/add/index?id=${this.data.accountId}` });
  },

  handleMore() {
    if (!this.data.account || !this.data.account.canManage || this.data.sharing || this.data.transferring || this.data.deleting) return;
    wx.showActionSheet({
      itemList: ['转移到其他团队', '永久删除动态验证码'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.handleTransfer();
        if (tapIndex === 1) this.handleDelete();
      },
    });
  },

  async handleTransfer() {
    if (!this.data.account || !this.data.account.canManage || this.data.sharing || this.data.deleting || this.data.transferring) return;
    if (!await app.guardMaintenance('转移动态验证码')) return;
    this.hideCode();
    this.setData({ transferOpen: true, targetTeamId: '', transferQuery: '', transferTeams: [], visibleTransferTeams: [] });
    await this.loadTransferTeams();
  },

  async loadTransferTeams() {
    if (this.data.transferring) return;
    const listVersion = this._transferListVersion = (this._transferListVersion || 0) + 1;
    this.setData({ transferLoading: true, transferError: '' });
    try {
      const teams = await api.fetchTeams();
      if (this._unloaded || listVersion !== this._transferListVersion) return;
      app.globalData.teams = teams;
      const source = teams.find((team) => team.teamId === this.data.account.teamId);
      if (!source || !['owner', 'admin'].includes(source.role)) throw new Error('你已没有当前团队的管理权限，请刷新页面');
      const transferTeams = teams.filter((team) => team.teamId !== source.teamId && ['owner', 'admin'].includes(team.role));
      this.setData({ transferTeams, 'account.teamName': source.name, targetTeamId: '' });
      this.filterTransferTeams();
    } catch (error) {
      if (!this._unloaded && listVersion === this._transferListVersion) {
        this.setData({ transferError: friendlyError(error, '团队列表加载失败'), transferTeams: [], visibleTransferTeams: [], targetTeamId: '' });
      }
    } finally {
      if (!this._unloaded && listVersion === this._transferListVersion) this.setData({ transferLoading: false });
    }
  },

  filterTransferTeams() {
    const query = this.data.transferQuery.trim().toLowerCase();
    this.setData({ visibleTransferTeams: this.data.transferTeams.filter((team) => team.name.toLowerCase().includes(query)) });
  },

  handleTransferSearch(e) {
    this.setData({ transferQuery: e.detail.value, targetTeamId: '' });
    this.filterTransferTeams();
  },

  handleTransferSelect(e) {
    if (this.data.transferring) return;
    const targetTeamId = e.currentTarget.dataset.id;
    if (this.data.transferTeams.some((team) => team.teamId === targetTeamId)) this.setData({ targetTeamId });
  },

  closeTransfer() {
    if (this.data.transferring) return;
    this._transferListVersion = (this._transferListVersion || 0) + 1;
    this.setData({ transferOpen: false, transferLoading: false, transferError: '', targetTeamId: '' });
  },

  stopPropagation() {},

  async confirmTransfer() {
    if (this.data.transferring || this.data.transferLoading || !this.data.account) return;
    const target = this.data.transferTeams.find((team) => team.teamId === this.data.targetTeamId);
    if (!target) return;
    const accountId = this.data.accountId;
    const sourceTeamId = this.data.account.teamId;
    this._accountRequestVersion = (this._accountRequestVersion || 0) + 1;
    this.setData({ transferring: true, transferError: '' });
    try {
      const confirm = await wx.showModal({
        title: '确认转移动态验证码？',
        content: `将转移到「${target.name}」。原团队成员将无法访问，目标团队成员可按权限使用。已有分享会同时撤销，验证码生成规则保持不变。`,
        confirmText: '确认转移',
        confirmColor: '#15803D',
      });
      if (!confirm.confirm || this._unloaded) return;
      this.hideCode();
      const result = await api.transferAccount(accountId, sourceTeamId, target.teamId);
      app.setActiveTeam(result.account.teamId);
      if (this._unloaded) return;
      this._sharesRequestVersion = (this._sharesRequestVersion || 0) + 1;
      this.setData({
        account: { ...result.account, teamName: target.name, canManage: true, canShare: true, updatedText: formatDate(result.account.updatedAt, true) },
        loading: false,
        error: '',
        transferOpen: false,
        targetTeamId: '',
        shareToken: '',
        shareExpiresText: '',
        shares: [],
        sharesLoading: false,
      });
      await this.loadAccount();
      wx.showToast({ title: '已转移到目标团队', icon: 'success' });
    } catch (error) {
      if (!this._unloaded) this.setData({ transferError: friendlyError(error, '转移失败，请刷新后重试') });
    } finally {
      if (!this._unloaded) this.setData({ transferring: false });
    }
  },

  async handleCreateShare() {
    if (this.data.sharing || this.data.transferring || this.data.deleting || !this.data.account || !this.data.account.canShare) return;
    if (!await app.guardMaintenance('创建动态码分享')) return;
    const durations = [
      { label: '5 分钟', seconds: 300 },
      { label: '30 分钟', seconds: 1800 },
      { label: '4 小时', seconds: 14400 },
      { label: '24 小时', seconds: 86400 },
    ];
    wx.showActionSheet({
      itemList: durations.map((item) => item.label),
      success: ({ tapIndex }) => {
        const duration = durations[tapIndex];
        if (duration) this.createShare(duration);
      },
    });
  },

  async createShare(duration) {
    if (this.data.sharing || this.data.transferring || this.data.deleting || this.data.transferOpen) return;
    this.setData({ sharing: true });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const result = await api.createShare({
        itemId: this.data.accountId,
        expiresInSec: duration.seconds,
        maxViews: 1,
      });
      this.setData({ shareToken: result.token, shareExpiresText: formatDate(result.expiresAt) });
      wx.showShareMenu({ withShareTicket: false });
      await this.loadShares();
      wx.showModal({
        title: '一次性分享已生成',
        content: `有效期至 ${formatDate(result.expiresAt)}，仅可领取一次。转发卡片不会显示动态码。`,
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '分享创建失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ sharing: false });
    }
  },

  async handleCopyShareToken() {
    if (!this.data.shareToken) return;
    try { await copyText(this.data.shareToken, { successMessage: '口令已复制' }); }
    catch (error) { wx.showToast({ title: friendlyError(error, '复制失败'), icon: 'none' }); }
  },

  async handleRevokeShare(e) {
    const shareId = e.currentTarget.dataset.id;
    if (!shareId) return;
    const confirm = await wx.showModal({
      title: '撤销此分享？',
      content: '撤销后尚未领取的一次性口令会立即失效。',
      confirmText: '立即撤销',
      confirmColor: '#B42318',
    });
    if (!confirm.confirm) return;
    try {
      await api.revokeShare(shareId);
      await this.loadShares();
      wx.showToast({ title: '分享已撤销', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '撤销失败'), icon: 'none' });
    }
  },

  async handleDelete() {
    if (!this.data.account || !this.data.account.canManage || this.data.sharing || this.data.transferring || this.data.deleting) return;
    this.setData({ deleting: true });
    this.hideCode();
    try {
      const first = await wx.showModal({
        title: '删除动态验证码？',
        content: '删除后所有成员将立即无法生成验证码，相关分享也会失效。',
        confirmText: '继续',
        confirmColor: '#B42318',
      });
      if (!first.confirm) return;
      const second = await wx.showModal({
        title: '再次确认',
        content: `确认永久删除「${this.data.account.issuer} · ${this.data.account.label}」？`,
        confirmText: '永久删除',
        confirmColor: '#B42318',
      });
      if (!second.confirm) return;
      wx.showLoading({ title: '删除中', mask: true });
      await api.deleteAccount(this.data.accountId);
      this.hideCode();
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '删除失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      if (!this._unloaded) this.setData({ deleting: false });
    }
  },

  handleRetry() {
    if (!this.data.transferring && !this.data.deleting) this.loadAccount();
  },

  onShareAppMessage() {
    if (this.data.shareToken && this.data.account) {
      return {
        title: `CodePool 一次性动态码：${this.data.account.issuer}`,
        path: `/pages/share/receive?token=${encodeURIComponent(this.data.shareToken)}`,
      };
    }
    return {
      title: 'CodePool · 团队安全代码池',
      path: '/pages/home/index',
    };
  },
});
