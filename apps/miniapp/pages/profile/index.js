const api = require('../../utils/api');
const { maskText, formatDate, friendlyError } = require('../../utils/format');

const app = getApp();

function getVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return info && info.miniProgram ? info.miniProgram.version || '开发版' : '开发版';
  } catch (error) {
    return '开发版';
  }
}

Page({
  data: {
    loading: true,
    needsLogin: false,
    loginLoading: false,
    saving: false,
    avatarProcessing: false,
    nicknameReviewPending: false,
    nicknameReviewInFlight: false,
    user: null,
    teams: [],
    profile: app.getStoredProfile(),
    legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
    userIdMasked: '',
    joinedText: '',
    privacyMask: true,
    version: getVersion(),
    apiBaseUrl: api.getBaseUrl(),
    deletionLoading: false,
    deletionRequest: null,
    deletionStatusLabel: '未申请',
    deletionRequestedText: '',
    canRequestDeletion: true,
    canWithdrawDeletion: false,
  },

  async onShow() {
    const hasSession = await app.awaitReady();
    const profile = app.getStoredProfile();
    this._approvedNickname = profile.nickname;
    if (!hasSession) {
      this.setData({ loading: false, needsLogin: true, user: null, teams: [], profile, nicknameReviewPending: false, nicknameReviewInFlight: false, legalConsent: app.hasLegalConsent() });
      return;
    }
    try {
      await app.refreshMe();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
        this.setData({ loading: false, needsLogin: true, user: null, teams: [], profile });
        return;
      }
    }
    this.applySession();
    await this.loadDeletionStatus();
  },

  applySession() {
    const user = app.globalData.user;
    const profile = app.getStoredProfile();
    this._approvedNickname = profile.nickname;
    this._reviewedNickname = '';
    this.setData({
      loading: false,
      needsLogin: !app.globalData.token,
      user,
      teams: app.globalData.teams || [],
      profile,
      nicknameReviewPending: false,
      nicknameReviewInFlight: false,
      userIdMasked: user ? maskText(user.id || user.openId, 4, 4) : '',
      joinedText: user ? formatDate(user.createdAt, true) : '',
      privacyMask: app.globalData.privacyMask,
    });
  },

  async onPullDownRefresh() {
    try {
      if (app.globalData.token) {
        await app.refreshMe();
        this.applySession();
        await this.loadDeletionStatus();
      }
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '刷新失败'), icon: 'none' });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadDeletionStatus() {
    if (!app.globalData.token) return;
    this.setData({ deletionLoading: true });
    try {
      const result = await api.fetchDeletionRequest();
      const request = result.request || null;
      const labels = {
        pending: '审核中',
        approved: '已批准，等待执行',
        rejected: '已拒绝',
        completed: '已完成',
        cancelled: '已撤回',
      };
      this.setData({
        deletionRequest: request,
        deletionStatusLabel: request ? labels[request.status] || request.status : '未申请',
        deletionRequestedText: request ? formatDate(request.requestedAt || request.requested_at, true) : '',
        canRequestDeletion: result.canRequest !== undefined ? result.canRequest : result.can_request,
        canWithdrawDeletion: result.canWithdraw !== undefined ? result.canWithdraw : result.can_withdraw,
      });
    } catch (error) {
      if (error.code !== 'UNAUTHORIZED') {
        wx.showToast({ title: friendlyError(error, '注销状态读取失败'), icon: 'none' });
      }
    } finally {
      this.setData({ deletionLoading: false });
    }
  },

  handleNicknameInput(e) {
    const nickname = e.detail.value;
    this.setData({
      'profile.nickname': nickname,
      nicknameReviewPending: nickname.trim() !== String(this._approvedNickname || '').trim(),
    });
  },

  handleNicknameBlur() {
    const nickname = this.data.profile.nickname;
    if (nickname.trim() === String(this._approvedNickname || '').trim()) {
      this.setData({ nicknameReviewPending: false, nicknameReviewInFlight: false });
      return;
    }
    this._reviewedNickname = nickname;
    this.setData({ nicknameReviewPending: true, nicknameReviewInFlight: true });
  },

  handleNicknameReview(e) {
    const reviewedNickname = this._reviewedNickname;
    if (!reviewedNickname || reviewedNickname !== this.data.profile.nickname) {
      this.setData({ nicknameReviewInFlight: false });
      return;
    }
    if (e.detail && e.detail.pass === true) {
      this._approvedNickname = reviewedNickname;
      this._reviewedNickname = '';
      this.setData({ nicknameReviewPending: false, nicknameReviewInFlight: false });
      return;
    }
    const nickname = this._approvedNickname || app.getStoredProfile().nickname;
    this._reviewedNickname = '';
    this.setData({ 'profile.nickname': nickname, nicknameReviewPending: false, nicknameReviewInFlight: false });
    wx.showToast({ title: e.detail && e.detail.timeout ? '昵称审核超时，请重新输入' : '昵称未通过微信安全审核', icon: 'none' });
  },

  async commitChosenAvatar(tempFilePath) {
    const avatarUrl = await app.persistAvatarFile(tempFilePath);
    app.setStoredProfile({ avatarUrl, avatar_url: avatarUrl, pendingAvatar: true });
    this.setData({
      'profile.avatarUrl': avatarUrl,
      'profile.avatar_url': avatarUrl,
      'profile.pendingAvatar': true,
    });
    if (!app.globalData.token) return;
    await app.syncStoredProfile({ updateNickname: false });
    const syncedProfile = app.getStoredProfile();
    this.setData({
      'profile.avatarUrl': syncedProfile.avatarUrl,
      'profile.avatar_url': syncedProfile.avatar_url,
      'profile.pendingAvatar': false,
    });
    wx.showToast({ title: '头像已更新', icon: 'success' });
  },

  async handleChooseAvatar(e) {
    const tempFilePath = e.detail && e.detail.avatarUrl;
    if (!tempFilePath || this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      await this.commitChosenAvatar(tempFilePath);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '头像更新失败'), icon: 'none' });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },

  async handleChooseAvatarFallback() {
    if (this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      const tempFilePath = await app.chooseAvatarImage();
      if (tempFilePath) await this.commitChosenAvatar(tempFilePath);
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

  async handleLogin() {
    if (this.data.loginLoading || this.data.avatarProcessing) return;
    if (this.data.nicknameReviewPending) {
      wx.showToast({ title: '请等待昵称安全审核完成', icon: 'none' });
      return;
    }
    if (!this.data.legalConsent) {
      wx.showToast({ title: '请先勾选同意隐私政策和用户协议', icon: 'none' });
      return;
    }
    app.setStoredProfile(this.data.profile);
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      this.applySession();
      await this.loadDeletionStatus();
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async handleSaveProfile() {
    if (this.data.saving || this.data.avatarProcessing) return;
    if (this.data.nicknameReviewPending) {
      wx.showToast({ title: '请等待昵称安全审核完成', icon: 'none' });
      return;
    }
    const nickname = (this.data.profile.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    app.setStoredProfile({ ...this.data.profile, nickname });
    this.setData({ saving: true });
    try {
      if (!app.globalData.token) await app.ensureLogin(true);
      else await app.syncStoredProfile();
      this.applySession();
      await this.loadDeletionStatus();
      wx.showToast({ title: '资料已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '资料更新失败'), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  handlePrivacyMask(e) {
    app.setPrivacyMask(e.detail.value);
    this.setData({ privacyMask: e.detail.value });
    if (e.detail.value) wx.showToast({ title: '已开启默认遮挡', icon: 'none' });
  },

  handleCopyUserId() {
    if (this.data.user && this.data.user.id) wx.setClipboardData({ data: this.data.user.id });
  },

  goTeam() {
    wx.switchTab({ url: '/pages/team/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },

  async handleClearCache() {
    const confirm = await wx.showModal({
      title: '清理本地缓存？',
      content: '将清除未保存的内容草稿与本地调试配置，不会删除团队服务端数据或退出登录。',
      confirmText: '清理',
    });
    if (!confirm.confirm) return;
    wx.removeStorageSync('CODEPOOL_ITEM_DRAFT');
    wx.removeStorageSync('CODEPOOL_API_BASE_URL');
    wx.showToast({ title: '本地缓存已清理', icon: 'success' });
  },

  async handleLogout() {
    const confirm = await wx.showModal({
      title: '退出当前账号？',
      content: '将清除本机登录凭证，团队服务端数据不会被删除。',
      confirmText: '退出登录',
    });
    if (!confirm.confirm) return;
    app.logout();
    this.setData({ needsLogin: true, user: null, teams: [], profile: app.getStoredProfile() });
    wx.showToast({ title: '已退出登录', icon: 'success' });
  },

  async handleCancellation() {
    if (this.data.deletionLoading) return;
    if (this.data.canWithdrawDeletion) {
      const withdraw = await wx.showModal({
        title: '撤回注销申请？',
        content: '撤回后账号和团队访问保持不变；如仍需注销，可稍后重新提交。',
        confirmText: '撤回申请',
      });
      if (!withdraw.confirm) return;
      this.setData({ deletionLoading: true });
      try {
        await api.withdrawDeletionRequest();
        await this.loadDeletionStatus();
        wx.showToast({ title: '申请已撤回', icon: 'success' });
      } catch (error) {
        wx.showToast({ title: friendlyError(error, '撤回失败'), icon: 'none' });
      } finally {
        this.setData({ deletionLoading: false });
      }
      return;
    }
    if (!this.data.canRequestDeletion) {
      wx.showModal({
        title: '注销申请处理中',
        content: `当前状态：${this.data.deletionStatusLabel}。运营主体、人工处理时限和客服渠道仍需在正式上线前配置。`,
        showCancel: false,
      });
      return;
    }
    const acknowledgement = await wx.showModal({
      title: '申请注销账号',
      content: '提交后将进入运营审核流程，账号不会立即删除。团队交接、数据保留规则和处理时限由正式运营政策确定。',
      cancelText: '暂不申请',
      confirmText: '继续填写',
      confirmColor: '#B42318',
    });
    if (!acknowledgement.confirm) return;
    const result = await wx.showModal({
      title: '注销原因（可选）',
      editable: true,
      placeholderText: '可选：填写注销原因（最多 500 字）',
      cancelText: '返回',
      confirmText: '提交申请',
      confirmColor: '#B42318',
    });
    if (!result.confirm) return;
    this.setData({ deletionLoading: true });
    try {
      await api.createDeletionRequest((result.content || '').trim().slice(0, 500));
      await this.loadDeletionStatus();
      wx.showToast({ title: '注销申请已提交', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '申请提交失败'), icon: 'none' });
    } finally {
      this.setData({ deletionLoading: false });
    }
  },

  async handleClearLocalLogin() {
    const result = await wx.showModal({
      title: '仅清除本地登录？',
      content: '此操作只删除本机登录凭证和未保存草稿，不会提交注销申请，也不会删除服务端账号与团队数据。',
      confirmText: '清除并退出',
    });
    if (!result.confirm) return;
    app.logout();
    wx.removeStorageSync('CODEPOOL_ITEM_DRAFT');
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
