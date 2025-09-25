const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    accountId: null,
    account: null,
    code: '-- ----',
    expiresIn: 0,
    period: 30,
    progress: 0,
    shares: [],
    loading: true,
  },

  onLoad(options) {
    this.setData({ accountId: Number(options.id) });
  },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    await this.fetchAccount();
    await this.fetchCode();
    await this.fetchShares();
  },

  async fetchAccount() {
    try {
      const account = await api.fetchAccountDetail(this.data.accountId);
      this.setData({ account, loading: false, period: account.period });
      wx.setNavigationBarTitle({ title: account.issuer });
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async fetchCode() {
    try {
      const res = await api.fetchAccountCode(this.data.accountId);
      const progress = Math.floor(((res.period - res.expiresIn) / res.period) * 100);
      this.setData({ code: res.code, expiresIn: res.expiresIn, period: res.period, progress });
    } catch (error) {
      wx.showToast({ title: '获取验证码失败', icon: 'none' });
    }
  },

  async fetchShares() {
    try {
      const list = await api.fetchShares(this.data.accountId);
      const items = Array.isArray(list) ? list : (list.items || []);
      this.setData({ shares: items });
    } catch (error) {
      console.warn('share fetch fail', error);
    }
  },

  handleCopy() {
    wx.setClipboardData({ data: this.data.code });
  },

  async handleRefresh() {
    await this.fetchCode();
  },

  async handleShare() {
    try {
      const res = await api.createShare({ account_id: this.data.accountId, mode: 'code', expires_in_minutes: 5 });
      wx.showModal({
        title: '分享链接',
        content: `分享口令：${res.token}\n5 分钟内有效，使用一次后失效`,
        showCancel: false,
      });
      this.fetchShares();
    } catch (error) {
      wx.showToast({ title: '分享失败', icon: 'none' });
    }
  },

  async handleDelete() {
    wx.showModal({
      title: '删除账号',
      content: '确认删除该账号？此操作不可恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteAccount(this.data.accountId);
            wx.showToast({ title: '删除成功' });
            setTimeout(() => wx.navigateBack(), 600);
          } catch (error) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      },
    });
  },
});
