const api = require('../../utils/api');
const {
  KIND_LABELS,
  formatDate,
  friendlyError,
} = require('../../utils/format');
const app = getApp();

const MASK_TEXT = '内容已安全遮挡';

function decode(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function tokenFromOptions(options) {
  if (options.token) return decode(options.token).trim();
  if (options.scene) {
    const scene = decode(options.scene).trim();
    const sceneMatch = /(?:^|&)token=([^&]+)/.exec(scene);
    return sceneMatch ? decode(sceneMatch[1]).trim() : scene;
  }
  if (options.q) {
    const url = decode(options.q);
    const match = /[?&]token=([^&#]+)/.exec(url);
    if (match) return decode(match[1]).trim();
  }
  return '';
}

Page({
  data: {
    token: '',
    preview: null,
    payload: null,
    loading: true,
    claiming: false,
    claimed: false,
    error: '',
    contentVisible: false,
    displayContent: MASK_TEXT,
    codeExpiresIn: 0,
    codeProgress: 100,
  },

  onLoad(options) {
    const token = tokenFromOptions(options || {});
    this.setData({ token });
    if (token) this.loadPreview();
    else this.setData({ loading: false, error: '分享地址不完整，缺少安全口令' });
  },

  onHide() {
    this.hideContent();
  },

  onUnload() {
    this.clearTicker();
    this.clearHideTimer();
    this._plainContent = '';
  },

  async loadPreview() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.previewShare(this.data.token);
      const share = result.share || {};
      const preview = {
        ...result,
        kindLabel: KIND_LABELS[result.kind] || '安全内容',
        shareExpiresText: formatDate(share.expiresAt || result.shareExpiresAt, true),
        remainingViews: share.remainingViews || result.remainingViews || result.remaining_views || 1,
      };
      this.setData({ preview, loading: false, error: '' });
      wx.setNavigationBarTitle({ title: '安全分享预览' });
    } catch (error) {
      this.setData({ loading: false, error: friendlyError(error, '分享已过期、已撤销或已领取') });
    }
  },

  async handleClaim() {
    if (this.data.claiming || this.data.claimed) return;
    if (!await app.guardMaintenance('领取安全分享')) return;
    const preview = this.data.preview || {};
    const confirm = await wx.showModal({
      title: '确认领取安全分享？',
      content: `领取「${preview.title || '安全内容'}」将消耗一次可领取次数。请确认当前环境安全，领取后不要截图或转发正文。`,
      confirmText: '确认领取',
      confirmColor: '#15803D',
    });
    if (!confirm.confirm) return;
    this.setData({ claiming: true, error: '' });
    try {
      const result = await api.redeemShare(this.data.token);
      const value = result.kind === 'totp' ? result.code : result.content;
      this._plainContent = value || '';
      const period = Number(result.period || 30);
      const expiresIn = Number(result.expiresIn !== undefined ? result.expiresIn : result.expires_in);
      this.setData({
        payload: {
          ...result,
          content: undefined,
          code: undefined,
          kindLabel: KIND_LABELS[result.kind] || '安全内容',
          period,
        },
        claimed: true,
        claiming: false,
        contentVisible: false,
        displayContent: MASK_TEXT,
        codeExpiresIn: Number.isFinite(expiresIn) ? Math.max(0, expiresIn) : period,
        codeProgress: 100,
      });
      if (result.kind === 'totp') this.startTicker();
      wx.setNavigationBarTitle({ title: '已领取安全分享' });
    } catch (error) {
      this.setData({ claiming: false, error: friendlyError(error, '领取失败，请稍后重试') });
    }
  },

  handleToggleContent() {
    if (this.data.contentVisible) {
      this.hideContent();
      return;
    }
    if (!this._plainContent) {
      wx.showToast({ title: '分享内容为空', icon: 'none' });
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

  startTicker() {
    this.clearTicker();
    this._ticker = setInterval(() => {
      const period = Number(this.data.payload && this.data.payload.period) || 30;
      const remaining = Math.max(0, Number(this.data.codeExpiresIn) - 1);
      this.setData({
        codeExpiresIn: remaining,
        codeProgress: period ? Math.round((remaining / period) * 100) : 0,
      });
      if (remaining <= 0) {
        this.clearTicker();
        this.hideContent();
      }
    }, 1000);
  },

  clearTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  async handleCopy() {
    if (!this._plainContent) return;
    const expiredCode = this.data.payload && this.data.payload.kind === 'totp' && this.data.codeExpiresIn <= 0;
    if (expiredCode) {
      wx.showToast({ title: '动态码已过期，无法再次领取', icon: 'none' });
      return;
    }
    const confirm = await wx.showModal({
      title: '复制到剪贴板？',
      content: '系统剪贴板可能被其他应用读取。请仅粘贴到可信目标，并在使用后及时覆盖。',
      confirmText: '复制',
      confirmColor: '#15803D',
    });
    if (confirm.confirm) wx.setClipboardData({ data: this._plainContent });
  },

  handleRetry() {
    if (this.data.claimed) return;
    this.loadPreview();
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },
});
