const api = require('../../utils/api');

Page({
  data: {
    token: '',
    payload: null,
    loading: true,
    error: '',
  },

  async onLoad(options) {
    let token = options.token;
    if (!token && options.scene) {
      token = decodeURIComponent(options.scene);
    }
    this.setData({ token });
    if (token) {
      await this.redeem(token);
    } else {
      this.setData({ loading: false, error: '缺少分享口令' });
    }
  },

  async redeem(token) {
    try {
      const payload = await api.redeemShare(token);
      this.setData({ payload, loading: false });
    } catch (error) {
      this.setData({ error: '分享已失效或不存在', loading: false });
    }
  },

  handleCopy() {
    if (!this.data.payload) return;
    const text = this.data.payload.code || this.data.payload.secret;
    wx.setClipboardData({ data: text });
  },
});
