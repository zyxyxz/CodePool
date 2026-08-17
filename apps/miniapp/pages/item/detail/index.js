const api = require('../../../utils/api');
const app = getApp();

Page({
  data: { itemId: '', item: null, loading: true },

  onLoad(options) { this.setData({ itemId: options.id || '' }); },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession) {
      wx.navigateBack();
      return;
    }
    await this.loadItem();
  },

  async loadItem() {
    this.setData({ loading: true });
    try {
      const item = await api.fetchItem(this.data.itemId);
      this.setData({ item, loading: false });
      wx.setNavigationBarTitle({ title: item.title });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: '内容不存在或无权访问', icon: 'none' });
    }
  },

  handleCopy() {
    if (this.data.item) wx.setClipboardData({ data: this.data.item.content });
  },

  async handleShare() {
    try {
      const result = await api.createShare({ itemId: this.data.itemId, expires_in_minutes: 5 });
      wx.showModal({
        title: '一次性分享口令',
        content: `${result.token}\n\n5 分钟内有效，领取一次后失效。`,
        confirmText: '复制',
        success: (res) => { if (res.confirm) wx.setClipboardData({ data: result.token }); },
      });
    } catch (error) {
      wx.showToast({ title: '分享失败', icon: 'none' });
    }
  },

  handleDelete() {
    wx.showModal({
      title: '移出代码池',
      content: '删除后无法恢复，确认继续？',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteItem(this.data.itemId);
          wx.showToast({ title: '已删除' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
});
