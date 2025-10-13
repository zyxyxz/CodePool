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

  onHide() {
    this.clearTicker();
  },

  onUnload() {
    this.clearTicker();
  },

  async fetchAccount() {
    try {
      const account = await api.fetchAccountDetail(this.data.accountId);
      this.setData({ account, loading: false, period: Number(account.period) || 30 });
      wx.setNavigationBarTitle({ title: account.issuer });
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async fetchCode() {
    try {
      const res = await api.fetchAccountCode(this.data.accountId);
      const total = Number(res.period) || this.data.period || 30;
      const expiresIn = Number(res.expiresIn);
      const safeExpires = Number.isFinite(expiresIn) && expiresIn >= 0 ? expiresIn : total;
      const progress = total ? Math.floor(((total - safeExpires) / total) * 100) : 0;
      this.setData({ code: res.code, expiresIn: safeExpires, period: total, progress });
      this.startTicker();
    } catch (error) {
      wx.showToast({ title: '获取验证码失败', icon: 'none' });
    }
  },

  startTicker() {
    this.clearTicker();
    if (!this.data.code) return;
    const ticker = setInterval(() => {
      const total = Number(this.data.period) || 30;
      const remaining = Number(this.data.expiresIn) - 1;
      if (remaining <= 0) {
        this.setData({ expiresIn: total, progress: 0 });
        this.fetchCode();
        return;
      }
      const safeRemaining = remaining < 0 ? 0 : remaining;
      const progress = total ? Math.floor(((total - safeRemaining) / total) * 100) : 0;
      this.setData({ expiresIn: safeRemaining, progress });
    }, 1000);
    this._ticker = ticker;
  },

  clearTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
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

  async handleEditRemark() {
    const account = this.data.account || {};
    if (!account) return;
    const current = account.remark || '';
    wx.showModal({
      title: '修改备注',
      editable: true,
      placeholderText: '输入备注内容，可为空',
      content: current,
      cancelText: '清空',
      success: async (res) => {
        if (!res.confirm && !res.cancel) {
          return;
        }
        const remark = res.confirm ? (res.content ?? '') : '';
        try {
          const updated = await api.updateAccount(
            this.data.accountId,
            { remark },
            { preserveEmptyKeys: ['remark'] }
          );
          this.setData({ account: updated });
          wx.showToast({ title: '备注已更新', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: '更新失败', icon: 'none' });
        }
      },
    });
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
