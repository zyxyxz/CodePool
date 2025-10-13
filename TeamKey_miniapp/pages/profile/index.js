const app = getApp();

Page({
  data: {
    user: null,
    teams: [],
    needsLogin: false,
    loginLoading: false,
    loginProfile: app.getStoredProfile ? app.getStoredProfile() : {
      nickname: 'TeamKey 用户',
      avatarUrl: '/assets/avatar-default.png',
    },
  },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      const profile = this.prepareLoginProfile();
      this.setData({ needsLogin: true, user: null, teams: [], loginProfile: profile });
      return;
    }
    this.setData({
      needsLogin: false,
      user: app.globalData.user,
      teams: app.globalData.teams,
      loginProfile: app.globalData.profile || app.getStoredProfile(),
    });
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      app.setStoredProfile(this.data.loginProfile);
      await app.ensureLogin(true);
      this.setData({
        needsLogin: false,
        user: app.globalData.user,
        teams: app.globalData.teams,
        loginProfile: app.globalData.profile,
      });
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async handleRelogin() {
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      this.setData({
        user: app.globalData.user,
        teams: app.globalData.teams,
        loginProfile: app.globalData.profile,
      });
      wx.showToast({ title: '已刷新' });
    } catch (error) {
      wx.showToast({ title: '刷新失败', icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  handleCopyOpenId() {
    if (!this.data.user || !this.data.user.openId) return;
    wx.setClipboardData({ data: this.data.user.openId });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出 TeamKey？',
      success: (res) => {
        if (res.confirm) {
          app.logout();
          const profile = this.prepareLoginProfile();
          this.setData({ user: null, teams: [], needsLogin: true, loginProfile: profile });
          wx.showToast({ title: '已退出' });
        }
      },
    });
  },

  async handleUpdateProfile() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      const res = await wx.getUserProfile({ desc: '用于完善账号资料' });
      const profile = app.setStoredProfile({
        nickname: res.userInfo.nickName,
        avatarUrl: res.userInfo.avatarUrl,
        avatar_url: res.userInfo.avatarUrl,
      });
      await app.ensureLogin(true);
      this.setData({
        user: app.globalData.user,
        teams: app.globalData.teams,
        loginProfile: profile,
      });
      wx.showToast({ title: '头像昵称已更新', icon: 'success' });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
        wx.showToast({ title: '已取消授权', icon: 'none' });
      } else {
        wx.showToast({ title: '更新失败', icon: 'none' });
        console.error('update profile failed', error);
      }
    } finally {
      this.setData({ loginLoading: false });
    }
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
