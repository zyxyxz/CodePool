const api = require('../../../utils/api');
const {
  KIND_LABELS,
  formatDate,
  friendlyError,
  isExpired,
} = require('../../../utils/format');

const app = getApp();

const MASK_TEXT = '敏感内容已遮挡\n点击“显示内容”后查看';

Page({
  data: {
    itemId: '',
    item: null,
    loading: true,
    error: '',
    offline: false,
    contentVisible: false,
    displayContent: MASK_TEXT,
    shares: [],
    sharesLoading: false,
    shareToken: '',
    shareExpiresText: '',
    sharing: false,
  },

  onLoad(options) {
    this.setData({ itemId: options.id || '' });
  },

  async onShow() {
    const hasSession = await app.awaitReady();
    if (!hasSession) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    await this.loadItem();
  },

  onHide() {
    this.hideContent();
  },

  onUnload() {
    this.clearHideTimer();
    this._plainContent = '';
  },

  async onPullDownRefresh() {
    try {
      await this.loadItem();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadItem() {
    if (!this.data.itemId) {
      this.setData({ loading: false, error: '缺少内容标识' });
      return;
    }
    this.hideContent();
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.fetchItem(this.data.itemId);
      const content = result.content || '';
      const item = {
        ...result,
        content: undefined,
        kindLabel: KIND_LABELS[result.kind] || '共享内容',
        createdText: formatDate(result.createdAt, true),
        updatedText: formatDate(result.updatedAt, true),
        expiresText: result.expiresAt ? formatDate(result.expiresAt, true) : '长期有效',
        expired: isExpired(result.expiresAt),
      };
      const team = app.globalData.teams.find((entry) => entry.teamId === item.teamId);
      const role = team ? team.role : 'guest';
      item.canEdit = role === 'owner' || role === 'admin' || role === 'member';
      item.canShare = item.canEdit;
      item.canDelete = role === 'owner' || role === 'admin';
      this._plainContent = content;
      this.setData({
        item,
        loading: false,
        error: '',
        offline: false,
        contentVisible: false,
        displayContent: MASK_TEXT,
      });
      wx.setNavigationBarTitle({ title: item.title || '内容详情' });
      await this.loadShares();
    } catch (error) {
      this._plainContent = '';
      this.setData({
        loading: false,
        error: friendlyError(error, '内容不存在或无权访问'),
        offline: Boolean(error.offline),
      });
    }
  },

  async loadShares() {
    this.setData({ sharesLoading: true });
    try {
      const rows = await api.fetchShares(this.data.itemId);
      const currentUserId = app.globalData.user && app.globalData.user.id;
      const elevated = Boolean(this.data.item && this.data.item.canDelete);
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
      this.setData({ shares: [] });
    } finally {
      this.setData({ sharesLoading: false });
    }
  },

  handleToggleContent() {
    if (this.data.contentVisible) {
      this.hideContent();
      return;
    }
    if (!this._plainContent) {
      wx.showToast({ title: '没有可显示的正文', icon: 'none' });
      return;
    }
    this.setData({ contentVisible: true, displayContent: this._plainContent });
    this.clearHideTimer();
    this._hideTimer = setTimeout(() => this.hideContent(), 60000);
  },

  hideContent() {
    this.clearHideTimer();
    if (this.data.contentVisible || this.data.displayContent !== MASK_TEXT) {
      this.setData({ contentVisible: false, displayContent: MASK_TEXT });
    }
  },

  clearHideTimer() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
  },

  async handleCopy() {
    if (!this._plainContent) return;
    const confirm = await wx.showModal({
      title: '复制敏感内容？',
      content: '复制后内容会进入系统剪贴板，可能被其他应用读取。请在使用后及时覆盖剪贴板。',
      confirmText: '继续复制',
      confirmColor: '#15803D',
    });
    if (confirm.confirm) wx.setClipboardData({ data: this._plainContent });
  },

  handleEdit() {
    if (!this.data.item || !this.data.item.canEdit) return;
    wx.navigateTo({ url: `/pages/item/add/index?id=${this.data.itemId}` });
  },

  async handleDuplicate() {
    if (!this.data.item || !this.data.item.canEdit || !this._plainContent) return;
    if (!await app.guardMaintenance('复制共享内容')) return;
    const confirm = await wx.showModal({
      title: '复制为新内容',
      content: '将在同一团队中新建一份独立副本，不复制现有分享链接。',
      confirmText: '创建副本',
    });
    if (!confirm.confirm) return;
    wx.showLoading({ title: '复制中', mask: true });
    try {
      const item = this.data.item;
      const copy = await api.createItem({
        teamId: item.teamId,
        kind: item.kind,
        title: `${item.title} - 副本`.slice(0, 120),
        identifier: item.identifier || '',
        language: item.language || '',
        content: this._plainContent,
        metadata: item.metadata || {},
      });
      wx.showToast({ title: '副本已创建', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: `/pages/item/detail/index?id=${copy.id}` }), 500);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '复制失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async handleCreateShare() {
    if (this.data.sharing || !this.data.item || !this.data.item.canShare) return;
    if (!await app.guardMaintenance('创建安全分享')) return;
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
        if (duration) this.chooseShareViews(duration);
      },
    });
  },

  chooseShareViews(duration) {
    const viewOptions = [1, 3, 5, 10];
    wx.showActionSheet({
      itemList: viewOptions.map((count) => `${count} 次领取`),
      success: ({ tapIndex }) => {
        const maxViews = viewOptions[tapIndex];
        if (maxViews) this.createShare(duration, maxViews);
      },
    });
  },

  async createShare(duration, maxViews) {
    this.setData({ sharing: true });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const result = await api.createShare({
        itemId: this.data.itemId,
        expiresInSec: duration.seconds,
        maxViews,
      });
      this.setData({
        shareToken: result.token,
        shareExpiresText: formatDate(result.expiresAt),
      });
      wx.showShareMenu({ withShareTicket: false });
      await this.loadShares();
      wx.showModal({
        title: '安全分享已生成',
        content: `有效期至 ${formatDate(result.expiresAt)}，最多领取 ${maxViews} 次。请使用下方“微信转发”，或复制口令。`,
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '分享创建失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ sharing: false });
    }
  },

  handleCopyShareToken() {
    if (this.data.shareToken) wx.setClipboardData({ data: this.data.shareToken });
  },

  async handleRevokeShare(e) {
    const shareId = e.currentTarget.dataset.id;
    if (!shareId) return;
    const confirm = await wx.showModal({
      title: '撤销此分享？',
      content: '撤销后尚未领取的口令会立即失效，已领取的内容无法远程收回。',
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
    if (!this.data.item || !this.data.item.canDelete) return;
    const first = await wx.showModal({
      title: '删除共享内容？',
      content: '正文、元数据和相关分享记录都将永久删除，此操作无法恢复。',
      confirmText: '继续',
      confirmColor: '#B42318',
    });
    if (!first.confirm) return;
    const second = await wx.showModal({
      title: '再次确认',
      content: `确认永久删除「${this.data.item.title}」？`,
      confirmText: '永久删除',
      confirmColor: '#B42318',
    });
    if (!second.confirm) return;
    wx.showLoading({ title: '删除中', mask: true });
    try {
      await api.deleteItem(this.data.itemId);
      this._plainContent = '';
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '删除失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleRetry() {
    this.loadItem();
  },

  onShareAppMessage() {
    if (this.data.shareToken && this.data.item) {
      return {
        title: `CodePool 安全分享：${this.data.item.title}`,
        path: `/pages/share/receive?token=${encodeURIComponent(this.data.shareToken)}`,
      };
    }
    return {
      title: 'CodePool · 团队安全代码池',
      path: '/pages/home/index',
    };
  },
});
