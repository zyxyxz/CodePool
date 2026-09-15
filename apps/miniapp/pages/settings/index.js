const api = require('../../utils/api');
const bio = require('../../utils/biometric');
const { getThemeData, getActiveThemeColor, applyPageTheme } = require('../../utils/theme');
const { CLIENT_VERSION } = require('../../config');
const { formatDate, friendlyError } = require('../../utils/format');

const app = getApp();

function getVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.version || CLIENT_VERSION;
  } catch (error) {
    return CLIENT_VERSION;
  }
}

const emptyDeletion = {
  deletionRequest: null,
  deletionStatusLabel: '未申请',
  deletionRequestedText: '',
  deletionError: '',
  canRequestDeletion: false,
  canWithdrawDeletion: false,
};

Page({
  handleLockNow() { app.lockVault(); },
  handleChangePin() { wx.navigateTo({ url: '/pages/lock/index?change=1' }); },
  data: {
    ...getThemeData(),
    loading: true,
    needsLogin: true,
    version: getVersion(),
    deletionLoading: false,
    bioEnabled: false,
    bioBusy: false,
    bioMode: '',
    bioLabel: '生物识别',
    bioHint: '正在检测本机支持情况…',
    ...emptyDeletion,
  },

  async onShow() {
    if (this.data.bioBusy) return;
    applyPageTheme(this, getActiveThemeColor(app));
    await app.awaitReady();
    const needsLogin = !app.globalData.token;
    this.setData({ loading: false, needsLogin, ...emptyDeletion });
    if (!needsLogin) await Promise.all([this.loadDeletionStatus(), this.loadBiometric()]);
  },

  async loadBiometric() {
    const userId = app.globalData.user?.id;
    const capability = await bio.capability();
    if (userId !== app.globalData.user?.id) return;
    this.setData({ bioEnabled: bio.enabled(userId), bioMode: capability.mode, bioLabel: capability.label, bioHint: capability.hint });
  },

  async toggleBiometric(e) {
    if (this.data.bioBusy || app.isVaultLocked()) return;
    const userId = app.globalData.user?.id;
    const epoch = app._lockEpoch;
    const enable = Boolean(e.detail.value);
    this.setData({ bioBusy: true });
    try {
      if (enable) {
        const capability = await bio.capability();
        if (!capability.mode) throw new Error(capability.hint);
        const grant = await bio.authenticate(api, capability.mode);
        if (userId !== app.globalData.user?.id || !app.acceptUnlock(grant, epoch)) throw new Error('钱包已锁定，请解锁后重新设置');
      }
      bio.setEnabled(userId, enable);
      this.setData({ bioEnabled: enable });
      wx.showToast({ title: enable ? '已开启，下次优先识别' : '已关闭，改用 PIN 解锁', icon: 'none' });
    } catch (error) {
      this.setData({ bioEnabled: bio.enabled(userId) });
      wx.showToast({ title: error.message || '未完成验证，设置未变更', icon: 'none' });
    } finally { this.setData({ bioBusy: false }); }
  },

  async loadDeletionStatus() {
    const sessionToken = app.globalData.token;
    if (!sessionToken) return;
    this.setData({ deletionLoading: true, deletionError: '' });
    try {
      const result = await api.fetchDeletionRequest();
      if (app.globalData.token !== sessionToken) return;
      const request = result.request || null;
      const labels = { pending: '审核中', approved: '已批准，等待执行', rejected: '已拒绝', completed: '已完成', cancelled: '已撤回' };
      this.setData({
        deletionRequest: request,
        deletionStatusLabel: request ? labels[request.status] || request.status : '未申请',
        deletionRequestedText: request ? formatDate(request.requestedAt || request.requested_at, true) : '',
        canRequestDeletion: Boolean(result.canRequest !== undefined ? result.canRequest : result.can_request),
        canWithdrawDeletion: Boolean(result.canWithdraw !== undefined ? result.canWithdraw : result.can_withdraw),
      });
    } catch (error) {
      if (app.globalData.token !== sessionToken) return;
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
        this.setData({ needsLogin: true, ...emptyDeletion });
      } else {
        this.setData({ ...emptyDeletion, deletionError: friendlyError(error, '状态读取失败，点击重试') });
      }
    } finally {
      this.setData({ deletionLoading: false });
    }
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },

  async handleClearCache() {
    const result = await wx.showModal({
      title: '清理本地缓存？',
      content: '将清除未保存的内容草稿，不会删除团队数据或退出登录。',
      confirmText: '清理',
    });
    if (!result.confirm) return;
    wx.removeStorageSync('CODEPOOL_ITEM_DRAFT');
    wx.removeStorageSync('CODEPOOL_API_BASE_URL');
    wx.showToast({ title: '本地缓存已清理', icon: 'success' });
  },

  async handleLogout() {
    if (!app.globalData.token) return;
    const result = await wx.showModal({
      title: '退出当前账号？',
      content: '将清除本机登录凭证，团队数据会保留。',
      confirmText: '退出登录',
    });
    if (!result.confirm) return;
    app.logout();
    this.setData({ needsLogin: true, ...emptyDeletion });
    wx.showToast({ title: '已退出登录', icon: 'success' });
  },

  async handleCancellation() {
    if (this.data.deletionLoading || !app.globalData.token) return;
    if (this.data.deletionError) {
      await this.loadDeletionStatus();
      return;
    }
    if (this._cancellationOpen) return;
    this._cancellationOpen = true;
    try {
      if (this.data.canWithdrawDeletion) {
        const result = await wx.showModal({
          title: '撤回注销申请？',
          content: `当前状态：${this.data.deletionStatusLabel}。撤回后账号和团队访问保持不变。`,
          confirmText: '撤回申请',
        });
        if (!result.confirm || !app.globalData.token) return;
        this.setData({ deletionLoading: true });
        await api.withdrawDeletionRequest();
        await this.loadDeletionStatus();
        wx.showToast({ title: '申请已撤回', icon: 'success' });
        return;
      }
      if (!this.data.canRequestDeletion) {
        await wx.showModal({
          title: '注销申请状态',
          content: `当前状态：${this.data.deletionStatusLabel}。可在隐私政策中查看数据处理规则和联系渠道。`,
          showCancel: false,
        });
        return;
      }
      const acknowledgement = await wx.showModal({
        title: '申请注销账号',
        content: '提交后将进入审核流程，账号不会立即删除。请先完成团队交接，并阅读隐私政策中的数据处理规则。',
        cancelText: '暂不申请',
        confirmText: '继续填写',
        confirmColor: '#B42318',
      });
      if (!acknowledgement.confirm) return;
      const result = await wx.showModal({
        title: '注销原因（可选）',
        editable: true,
        placeholderText: '填写注销原因（最多 500 字）',
        cancelText: '返回',
        confirmText: '提交申请',
        confirmColor: '#B42318',
      });
      if (!result.confirm || !app.globalData.token) return;
      this.setData({ deletionLoading: true });
      await api.createDeletionRequest((result.content || '').trim().slice(0, 500));
      await this.loadDeletionStatus();
      wx.showToast({ title: '注销申请已提交', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '注销申请操作失败'), icon: 'none' });
    } finally {
      this._cancellationOpen = false;
      this.setData({ deletionLoading: false });
    }
  },

  async handleClearLocalLogin() {
    if (!app.globalData.token) return;
    const result = await wx.showModal({
      title: '清除本地登录？',
      content: '清除本机登录凭证和未保存草稿，服务端账号与团队数据会保留。',
      confirmText: '清除并退出',
    });
    if (!result.confirm) return;
    app.logout();
    wx.removeStorageSync('CODEPOOL_ITEM_DRAFT');
    this.setData({ needsLogin: true, ...emptyDeletion });
    wx.showToast({ title: '本地登录已清除', icon: 'success' });
  },
});
