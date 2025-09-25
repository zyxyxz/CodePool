const api = require('../../../utils/api');
const app = getApp();

Page({
  data: {
    teams: [],
    teamIndex: 0,
    form: {
      issuer: '',
      label: '',
      accountIdentifier: '',
      secret: '',
      digits: 6,
      period: 30,
    },
    submitting: false,
    needsLogin: false,
  },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession) {
      this.setData({ needsLogin: true });
      return;
    }
    const teams = app.globalData.teams || [];
    const teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === app.globalData.activeTeamId));
    this.setData({ teams, teamIndex: teamIndex === -1 ? 0 : teamIndex, needsLogin: false });
  },

  handleInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  handleNumberInput(e) {
    const { field } = e.currentTarget.dataset;
    let value = Number(e.detail.value);
    if (Number.isNaN(value)) value = '';
    this.setData({ [`form.${field}`]: value });
  },

  handleTeamChange(e) {
    const index = Number(e.detail.value);
    this.setData({ teamIndex: index });
  },

  async handleScan() {
    const team = this.data.teams[this.data.teamIndex];
    if (!team) {
      wx.showToast({ title: '请先选择团队', icon: 'none' });
      return;
    }
    try {
      const { result } = await wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] });
      if (!result || result.indexOf('otpauth://') !== 0) {
        wx.showToast({ title: '不是有效的 otpauth 链接', icon: 'none' });
        return;
      }
      await this.submitAccount({ otpauth_url: result });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
        return;
      }
      wx.showToast({ title: '扫码失败', icon: 'none' });
      console.error('scan error', error);
    }
  },

  async handleSubmit() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const team = this.data.teams[this.data.teamIndex];
    if (!team) {
      wx.showToast({ title: '请选择团队', icon: 'none' });
      return;
    }
    const { issuer, label, secret, accountIdentifier, digits, period } = this.data.form;
    if (!issuer || !label || !secret) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    await this.submitAccount({
      team_id: team.teamId,
      issuer,
      label,
      secret,
      account_identifier: accountIdentifier,
      digits: Number(digits) || 6,
      period: Number(period) || 30,
    });
  },

  async submitAccount(payload) {
    const team = this.data.teams[this.data.teamIndex];
    if (!team) return;
    const requestPayload = { team_id: team.teamId, ...payload };
    this.setData({ submitting: true });
    try {
      await api.createAccount(requestPayload);
      wx.showToast({ title: '添加成功' });
      await app.tryRestoreSession();
      setTimeout(() => {
        wx.navigateBack();
      }, 600);
    } catch (error) {
      console.error('create account error', error);
      wx.showToast({ title: error?.message || '添加失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
  handleGoLogin() {
    wx.navigateBack();
  },
});
