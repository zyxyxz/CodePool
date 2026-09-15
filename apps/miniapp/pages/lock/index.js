const api = require('../../utils/api');
const bio = require('../../utils/biometric');
const { getThemeData, applyPageTheme } = require('../../utils/theme');
const app = getApp();
Page({
  data: { ...getThemeData(), loading: true, configured: false, changing: false, pin: '', confirmPin: '', busy: false, error: '', authMode: '', authLabel: '', bioEnabled: false, bioHint: '', showPin: true, setupBiometric: true, bioChecking: true },
  onLoad(options) { this._change = options.change === '1'; },
  async onShow() {
    this._visible = true;
    // Native authentication can briefly return focus to this page. Do not
    // restart a pending operation or automatically re-prompt after cancellation.
    if (this.data.busy) return;
    applyPageTheme(this);
    if (!await app.awaitReady({ allowLocked: true })) {
      if (!app.globalData.token) wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    this.setData({ pin: '', confirmPin: '', changing: Boolean(this._change && api.isUnlocked()), busy: false });
    await this.loadStatus();
    const capability = await bio.capability();
    if (!this._visible) return;
    const bioEnabled = bio.enabled(app.globalData.user?.id);
    const preferBio = this.data.configured && !this.data.changing && bioEnabled && Boolean(capability.mode);
    this.setData({ authMode: capability.mode, authLabel: `${capability.label}解锁`, bioEnabled, bioHint: capability.hint, showPin: !preferBio, bioChecking: false });
    if (preferBio && !this._autoAttempted && !this.data.error) {
      this._autoAttempted = true;
      await this.biometric();
    }
  },
  onHide() { this._visible = false; this.setData({ pin: '', confirmPin: '' }); },
  onUnload() { this._visible = false; },
  usePin() { if (!this.data.busy) this.setData({ showPin: true, error: '', pin: '' }); },
  async loadStatus() {
    this.setData({ loading: true, error: '' });
    try { const state = await api.lockStatus(); this.setData({ configured: state.configured }); }
    catch (error) { this.setData({ error: error.message || '无法读取安全设置，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  onPin(e) { this.setData({ pin: e.detail.value }); },
  onConfirm(e) { this.setData({ confirmPin: e.detail.value }); },
  onSetupBiometric(e) { if (!this.data.busy) this.setData({ setupBiometric: Boolean(e.detail.value) }); },
  async finish(grant, epoch) {
    if (!app.acceptUnlock(grant, epoch)) { this.setData({ error: '已重新锁定，请再验证一次' }); return; }
    this.setData({ pin: '', confirmPin: '' });
    await app.consumePendingInvite();
    if (!app.isVaultLocked()) wx.reLaunch({ url: '/pages/home/index' });
  },
  async submit(e) {
    if (this.data.busy || this.data.loading || this.data.bioChecking) return;
    const values = e.detail.value;
    const action = this.data.changing ? 'change' : this.data.configured ? 'pin' : 'setup';
    if (!/^\d{6}$/.test(values.pin || '')) { this.setData({ error: '请输入 6 位数字 PIN' }); return; }
    if (action !== 'pin' && values.pin !== values.confirmPin) { this.setData({ error: '两次 PIN 不一致' }); return; }
    const epoch = app._lockEpoch;
    const userId = app.globalData.user?.id;
    const enableOnSetup = action === 'setup' && this.data.setupBiometric && Boolean(this.data.authMode);
    this.setData({ busy: true, error: '', pin: '', confirmPin: '' });
    try {
      let grant = await api.unlock({ action, pin: values.pin, ...(action === 'pin' ? {} : { confirmPin: values.confirmPin }) });
      if (action === 'setup') {
        // PIN has already been persisted, even if the optional native prompt
        // is cancelled. Never retry setup or overwrite an existing preference.
        this.setData({ configured: true });
        if (epoch !== app._lockEpoch || userId !== app.globalData.user?.id) throw new Error('已重新锁定，请使用新 PIN 解锁');
        if (enableOnSetup) {
          try {
            grant = await bio.authenticate(api, this.data.authMode);
            if (userId !== app.globalData.user?.id || !app.acceptUnlock(grant, epoch)) throw new Error('已重新锁定');
            bio.setEnabled(userId, true);
            this.setData({ bioEnabled: true });
          } catch {
            wx.showToast({ title: 'PIN 已设置；生物识别未开启，可稍后在设置开启', icon: 'none', duration: 3000 });
          }
        }
      }
      await this.finish(grant, epoch);
    } catch (error) { this.setData({ error: error.message || '验证失败，请重试' }); }
    finally { this.setData({ busy: false }); }
  },
  async biometric() {
    if (this.data.busy || !this.data.configured || !this.data.authMode || !this.data.bioEnabled || this.data.changing) return;
    const epoch = app._lockEpoch;
    this.setData({ busy: true, error: '' });
    try {
      const grant = await bio.authenticate(api, this.data.authMode);
      if (epoch !== app._lockEpoch) throw new Error('已重新锁定，请重试');
      await this.finish(grant, epoch);
    } catch (error) { this.setData({ error: error.message || '识别未完成，可重新识别或使用 PIN 解锁' }); }
    finally { this.setData({ busy: false }); }
  },
  forgot() { wx.showModal({ title: '忘记 PIN', content: '可先使用生物识别解锁，再到设置中修改 PIN。若两种方式均不可用，请联系客服进行身份核验。退出登录、清缓存不会重置 PIN。', showCancel: false }); },
  logout() { if (this.data.busy) return; app.logout(); wx.reLaunch({ url: '/pages/home/index' }); },
});
