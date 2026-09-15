const api = require('../../utils/api');
const { getThemeData, applyPageTheme } = require('../../utils/theme');
const app = getApp();
const nativeCall = (name, options = {}) => new Promise((resolve, reject) => {
  if (typeof wx[name] !== 'function') { reject(new Error('当前设备不支持生物识别，请使用 PIN')); return; }
  wx[name]({ ...options, success: resolve, fail: reject });
});
Page({
  data: { ...getThemeData(), loading: true, configured: false, changing: false, pin: '', confirmPin: '', busy: false, error: '', authMode: '', authLabel: '' },
  onLoad(options) { this._change = options.change === '1'; },
  async onShow() {
    applyPageTheme(this);
    if (!await app.awaitReady({ allowLocked: true })) {
      if (!app.globalData.token) wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    this.setData({ pin: '', confirmPin: '', changing: Boolean(this._change && api.isUnlocked()), busy: false });
    await this.loadStatus();
    try {
      const supported = await nativeCall('checkIsSupportSoterAuthentication');
      for (const mode of ['facial', 'fingerPrint']) {
        if (!(supported.supportMode || []).includes(mode)) continue;
        const result = await nativeCall('checkIsSoterEnrolledInDevice', { checkAuthMode: mode });
        if (result.isEnrolled) { this.setData({ authMode: mode, authLabel: mode === 'facial' ? '人脸识别解锁' : '指纹解锁' }); break; }
      }
    } catch { /* PIN remains available on unsupported devices. */ }
  },
  onHide() { this.setData({ pin: '', confirmPin: '' }); },
  async loadStatus() {
    this.setData({ loading: true, error: '' });
    try { const state = await api.lockStatus(); this.setData({ configured: state.configured }); }
    catch (error) { this.setData({ error: error.message || '无法读取安全设置，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  onPin(e) { this.setData({ pin: e.detail.value }); },
  onConfirm(e) { this.setData({ confirmPin: e.detail.value }); },
  async finish(grant, epoch) {
    if (!app.acceptUnlock(grant, epoch)) { this.setData({ error: '已重新锁定，请再验证一次' }); return; }
    this.setData({ pin: '', confirmPin: '' });
    await app.consumePendingInvite();
    if (!app.isVaultLocked()) wx.reLaunch({ url: '/pages/home/index' });
  },
  async submit(e) {
    if (this.data.busy || this.data.loading) return;
    const values = e.detail.value;
    const action = this.data.changing ? 'change' : this.data.configured ? 'pin' : 'setup';
    if (!/^\d{6}$/.test(values.pin || '')) { this.setData({ error: '请输入 6 位数字 PIN' }); return; }
    if (action !== 'pin' && values.pin !== values.confirmPin) { this.setData({ error: '两次 PIN 不一致' }); return; }
    const epoch = app._lockEpoch;
    this.setData({ busy: true, error: '', pin: '', confirmPin: '' });
    try {
      const grant = await api.unlock({ action, pin: values.pin, ...(action === 'pin' ? {} : { confirmPin: values.confirmPin }) });
      await this.finish(grant, epoch);
    } catch (error) { this.setData({ error: error.message || '验证失败，请重试' }); }
    finally { this.setData({ busy: false }); }
  },
  async biometric() {
    if (this.data.busy || !this.data.configured || !this.data.authMode) return;
    const epoch = app._lockEpoch;
    this.setData({ busy: true, error: '' });
    try {
      const { challenge } = await api.unlock({ action: 'challenge' });
      const result = await nativeCall('startSoterAuthentication', { requestAuthModes: [this.data.authMode], challenge, authContent: '解锁 CodePool 密钥钱包' });
      if (epoch !== app._lockEpoch) throw new Error('已重新锁定，请重试');
      const grant = await api.unlock({ action: 'biometric', resultJSON: result.resultJSON, signature: result.resultJSONSignature });
      await this.finish(grant, epoch);
    } catch (error) { this.setData({ error: error.message || '生物识别未完成，请重试或输入 PIN' }); }
    finally { this.setData({ busy: false }); }
  },
  forgot() { wx.showModal({ title: '忘记 PIN', content: '可先使用生物识别解锁，再到设置中修改 PIN。若两种方式均不可用，请联系客服进行身份核验。退出登录、清缓存不会重置 PIN。', showCancel: false }); },
  logout() { if (this.data.busy) return; app.logout(); wx.reLaunch({ url: '/pages/home/index' }); },
});
