const app = getApp();

Page({
  data: {
    user: null,
    teams: [],
    needsLogin: false,
    loginLoading: false,
  },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      this.setData({ needsLogin: true, user: null, teams: [] });
      return;
    }
    this.setData({ needsLogin: false, user: app.globalData.user, teams: app.globalData.teams });
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      this.setData({ needsLogin: false, user: app.globalData.user, teams: app.globalData.teams });
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
      this.setData({ user: app.globalData.user, teams: app.globalData.teams });
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
          this.setData({ user: null, teams: [], needsLogin: true });
          wx.showToast({ title: '已退出' });
        }
      },
    });
  },
});
