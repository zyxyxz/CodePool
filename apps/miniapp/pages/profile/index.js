const { maskText, formatDate, friendlyError } = require('../../utils/format');
const { submittedNickname, notifyNicknameReview } = require('../../utils/nickname');
const { copyText } = require('../../utils/clipboard');
const { getThemeData, getActiveThemeColor, applyPageTheme } = require('../../utils/theme');

const app = getApp();

Page({
  data: {
    ...getThemeData(),
    loading: true,
    needsLogin: false,
    loginLoading: false,
    saving: false,
    avatarProcessing: false,
    user: null,
    teams: [],
    profile: app.getStoredProfile(),
    legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
    userIdMasked: '',
    joinedText: '',
  },

  async onShow() {
    applyPageTheme(this, getActiveThemeColor(app));
    const hasSession = await app.awaitReady();
    const profile = app.getStoredProfile();
    if (!hasSession) {
      this.setData({ loading: false, needsLogin: true, user: null, teams: [], profile, legalConsent: app.hasLegalConsent() });
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
  },

  applySession() {
    applyPageTheme(this, getActiveThemeColor(app));
    const user = app.globalData.user;
    const profile = app.getStoredProfile();
    this.setData({
      loading: false,
      needsLogin: !app.globalData.token,
      user,
      teams: app.globalData.teams || [],
      profile,
      userIdMasked: user ? maskText(user.id || user.openId, 4, 4) : '',
      joinedText: user ? formatDate(user.createdAt, true) : '',
    });
  },

  async onPullDownRefresh() {
    try {
      if (app.globalData.token) {
        await app.refreshMe();
        this.applySession();
      }
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '刷新失败'), icon: 'none' });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  handleNicknameReview: notifyNicknameReview,

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

  async handleLogin(e) {
    if (this.data.loginLoading || this.data.avatarProcessing) return;
    if (!this.data.legalConsent) {
      wx.showToast({ title: '请先勾选同意隐私政策和用户协议', icon: 'none' });
      return;
    }
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      if (app.needsProfileSetup && app.needsProfileSetup()) return;
      this.applySession();
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async handleSaveProfile(e) {
    if (this.data.saving || this.data.avatarProcessing) return;
    const previousNickname = app.getStoredProfile().nickname;
    this.setData({ saving: true });
    try {
      const nickname = submittedNickname(e);
      app.setStoredProfile({ nickname });
      if (!app.globalData.token) await app.ensureLogin(true);
      else await app.syncStoredProfile({ updateAvatar: false });
      this.applySession();
      wx.showToast({ title: '资料已更新', icon: 'success' });
    } catch (error) {
      app.setStoredProfile({ nickname: previousNickname });
      wx.showToast({ title: friendlyError(error, '资料更新失败'), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async handleCopyUserId() {
    if (!this.data.user || !this.data.user.id) return;
    try {
      await copyText(this.data.user.id, { successMessage: '成员编号已复制' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '复制失败'), icon: 'none' });
    }
  },

  goTeam() {
    wx.switchTab({ url: '/pages/team/index' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },
});
