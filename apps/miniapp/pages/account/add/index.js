const api = require('../../../utils/api');
const { friendlyError } = require('../../../utils/format');

const app = getApp();

const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
const DIGITS = [6, 8];
const PERIODS = [30, 60];

function parseQuery(query) {
  const params = {};
  String(query || '').split('&').forEach((pair) => {
    const index = pair.indexOf('=');
    if (index < 0) return;
    const key = decodeURIComponent(pair.slice(0, index));
    const value = decodeURIComponent(pair.slice(index + 1).replace(/\+/g, ' '));
    params[key] = value;
  });
  return params;
}

function parseOtpAuth(value) {
  const match = /^otpauth:\/\/totp\/([^?]+)\?(.+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  let pathLabel = '';
  try {
    pathLabel = decodeURIComponent(match[1]);
  } catch (error) {
    pathLabel = match[1];
  }
  const params = parseQuery(match[2]);
  const parts = pathLabel.split(':');
  const issuer = (params.issuer || (parts.length > 1 ? parts[0] : '')).trim();
  const label = (parts.length > 1 ? parts.slice(1).join(':') : pathLabel).trim();
  const secret = (params.secret || '').replace(/\s/g, '').toUpperCase();
  if (!issuer || !label || !secret) return null;
  return {
    issuer,
    label,
    accountIdentifier: label,
    secret,
    algorithm: String(params.algorithm || 'SHA1').toUpperCase(),
    digits: Number(params.digits || 6),
    period: Number(params.period || 30),
  };
}

Page({
  data: {
    accountId: '',
    editing: false,
    loading: true,
    error: '',
    teams: [],
    teamIndex: 0,
    algorithms: ALGORITHMS,
    algorithmIndex: 0,
    digitsOptions: DIGITS,
    digitsIndex: 0,
    periodOptions: PERIODS,
    periodIndex: 0,
    secretVisible: false,
    submitting: false,
    form: {
      issuer: '',
      label: '',
      accountIdentifier: '',
      secret: '',
      remark: '',
    },
  },

  onLoad(options) {
    const accountId = options.id || '';
    this.setData({ accountId, editing: Boolean(accountId) });
  },

  async onShow() {
    if (this._ready) return;
    const hasSession = await app.awaitReady();
    if (!hasSession) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    await this.initialize();
  },

  async initialize() {
    this.setData({ loading: true, error: '' });
    try {
      const teams = app.globalData.teams.length ? app.globalData.teams : await api.fetchTeams();
      let teamIndex = teams.findIndex((team) => team.teamId === app.globalData.activeTeamId);
      if (teamIndex < 0) teamIndex = 0;
      this.setData({ teams, teamIndex });
      if (this.data.editing) await this.loadAccount();
      this._ready = true;
      this.setData({ loading: false });
    } catch (error) {
      this.setData({ loading: false, error: friendlyError(error, '表单加载失败') });
    }
  },

  async loadAccount() {
    const account = await api.fetchAccountDetail(this.data.accountId);
    const algorithmIndex = Math.max(0, ALGORITHMS.indexOf(account.algorithm));
    const digitsIndex = Math.max(0, DIGITS.indexOf(Number(account.digits)));
    const periodIndex = Math.max(0, PERIODS.indexOf(Number(account.period)));
    const teamIndex = Math.max(0, this.data.teams.findIndex((team) => team.teamId === account.teamId));
    this.setData({
      teamIndex,
      algorithmIndex,
      digitsIndex,
      periodIndex,
      form: {
        issuer: account.issuer || '',
        label: account.label || '',
        accountIdentifier: account.accountIdentifier || '',
        secret: '',
        remark: account.remark || '',
      },
    });
    wx.setNavigationBarTitle({ title: '编辑动态验证码' });
  },

  handleInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  handleTeamChange(e) {
    if (!this.data.editing) this.setData({ teamIndex: Number(e.detail.value) });
  },

  handleAlgorithmChange(e) {
    if (!this.data.editing) this.setData({ algorithmIndex: Number(e.detail.value) });
  },

  handleDigitsChange(e) {
    if (!this.data.editing) this.setData({ digitsIndex: Number(e.detail.value) });
  },

  handlePeriodChange(e) {
    if (!this.data.editing) this.setData({ periodIndex: Number(e.detail.value) });
  },

  handleToggleSecret() {
    this.setData({ secretVisible: !this.data.secretVisible });
  },

  async handlePasteSecret() {
    try {
      const result = await wx.getClipboardData();
      const secret = String(result.data || '').replace(/\s/g, '').toUpperCase();
      if (!secret) {
        wx.showToast({ title: '剪贴板没有密钥', icon: 'none' });
        return;
      }
      this.setData({ 'form.secret': secret });
    } catch (error) {
      wx.showToast({ title: '无法读取剪贴板', icon: 'none' });
    }
  },

  async handleScan() {
    try {
      const scan = await wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] });
      const parsed = parseOtpAuth(scan.result);
      if (!parsed) {
        wx.showToast({ title: '不是有效的 TOTP 二维码', icon: 'none' });
        return;
      }
      const algorithmIndex = Math.max(0, ALGORITHMS.indexOf(parsed.algorithm));
      const digitsIndex = Math.max(0, DIGITS.indexOf(parsed.digits));
      const periodIndex = Math.max(0, PERIODS.indexOf(parsed.period));
      this.setData({
        'form.issuer': parsed.issuer,
        'form.label': parsed.label,
        'form.accountIdentifier': parsed.accountIdentifier,
        'form.secret': parsed.secret,
        algorithmIndex,
        digitsIndex,
        periodIndex,
      });
      wx.showToast({ title: '已安全读取二维码', icon: 'success' });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: '扫码失败', icon: 'none' });
    }
  },

  validate() {
    const form = this.data.form;
    if (!this.data.teams[this.data.teamIndex]) return '请选择所属团队';
    const team = this.data.teams[this.data.teamIndex];
    if (team.role !== 'owner' && team.role !== 'admin') return '仅所有者和管理员可管理动态码';
    if (!form.issuer.trim()) return '请输入服务名称';
    if (!form.label.trim()) return '请输入账号标签';
    if (!this.data.editing) {
      const secret = form.secret.replace(/\s/g, '').toUpperCase();
      if (secret.length < 8) return '密钥至少需要 8 个字符';
      if (!/^[A-Z2-7]+=*$/.test(secret)) return '密钥应为 Base32 格式';
    }
    return '';
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    if (!await app.guardMaintenance(this.data.editing ? '保存动态码信息' : '新增动态验证码')) return;
    const validation = this.validate();
    if (validation) {
      wx.showToast({ title: validation, icon: 'none' });
      return;
    }
    const form = this.data.form;
    const team = this.data.teams[this.data.teamIndex];
    this.setData({ submitting: true });
    try {
      if (this.data.editing) {
        await api.updateAccount(this.data.accountId, {
          issuer: form.issuer.trim(),
          label: form.label.trim(),
          accountIdentifier: form.accountIdentifier.trim(),
          remark: form.remark.trim(),
        }, { preserveEmptyKeys: ['accountIdentifier', 'remark'] });
      } else {
        await api.createAccount({
          team_id: team.teamId,
          issuer: form.issuer.trim(),
          label: form.label.trim(),
          account_identifier: form.accountIdentifier.trim(),
          secret: form.secret.replace(/\s/g, '').toUpperCase(),
          algorithm: ALGORITHMS[this.data.algorithmIndex],
          digits: DIGITS[this.data.digitsIndex],
          period: PERIODS[this.data.periodIndex],
          remark: form.remark.trim(),
        });
      }
      wx.showToast({ title: this.data.editing ? '修改已保存' : '动态码已添加', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  handleRetry() {
    this.initialize();
  },
});
