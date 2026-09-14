const { submittedNickname, notifyNicknameReview } = require('../../utils/nickname');
const { getThemeData, applyPageTheme } = require('../../utils/theme');
const { friendlyError } = require('../../utils/format');
const app = getApp();

Page({
  data: { ...getThemeData(), nickname: '', avatarUrl: '', saving: false, avatarProcessing: false, error: '' },
  async onShow() {
    applyPageTheme(this);
    if (!await app.awaitReady({ allowIncompleteProfile: true })) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    if (!app.needsProfileSetup()) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    const profile = app.getStoredProfile();
    this.setData({
      nickname: ['微信用户', 'CodePool 用户'].includes(profile.nickname) ? '' : profile.nickname || '',
      avatarUrl: profile.pendingAvatar || app.globalData.user.avatarUrl ? profile.avatarUrl : '',
    });
  },
  handleNicknameReview: notifyNicknameReview,
  async chooseAvatar(path) {
    if (!path || this.data.saving || this.data.avatarProcessing) return;
    const userId = app.globalData.user && app.globalData.user.id;
    this.setData({ avatarProcessing: true, error: '' });
    try {
      const avatarUrl = await app.persistAvatarFile(path);
      if (!app.globalData.user || app.globalData.user.id !== userId) return;
      app.setStoredProfile({ avatarUrl, avatar_url: avatarUrl, pendingAvatar: true });
      this.setData({ avatarUrl });
    } catch (error) {
      this.setData({ error: friendlyError(error, '头像处理失败，请重试') });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },
  handleChooseAvatar(e) { return this.chooseAvatar(e.detail && e.detail.avatarUrl); },
  async handleAlbum() {
    if (this.data.saving || this.data.avatarProcessing || this._choosing) return;
    this._choosing = true;
    try { await this.chooseAvatar(await app.chooseAvatarImage()); }
    catch (error) { this.setData({ error: friendlyError(error, '无法选择头像') }); }
    finally { this._choosing = false; }
  },
  async handleSubmit(e) {
    if (this.data.saving || this.data.avatarProcessing || this._choosing) return;
    this.setData({ saving: true, error: '' });
    try {
      const nickname = submittedNickname(e);
      if (['微信用户', 'CodePool 用户'].includes(nickname)) throw new Error('请设置一个属于你的昵称');
      if (!this.data.avatarUrl) throw new Error('请先选择头像，可使用微信头像或相册图片');
      this.setData({ nickname });
      app.setStoredProfile({ nickname });
      await app.syncStoredProfile();
      if (app.needsProfileSetup()) throw new Error('资料尚未保存完整，请重新选择头像后重试');
      await app.consumePendingInvite();
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: friendlyError(error, '资料保存失败，请重试') });
    } finally { this.setData({ saving: false }); }
  },
  handleLogout() {
    if (this.data.saving || this.data.avatarProcessing || this._choosing) return;
    app.logout();
    wx.reLaunch({ url: '/pages/home/index' });
  },
  goPrivacy() { wx.navigateTo({ url: '/pages/legal/index?type=privacy' }); },
});
