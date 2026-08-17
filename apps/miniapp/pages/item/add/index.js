const api = require('../../../utils/api');
const app = getApp();

const KINDS = [
  { label: '代码片段', value: 'snippet' },
  { label: '一次性验证码', value: 'code' },
  { label: '临时密文', value: 'secret' },
  { label: '团队备注', value: 'note' },
];
const EXPIRATIONS = [
  { label: '不过期', seconds: 0 },
  { label: '5 分钟', seconds: 300 },
  { label: '1 小时', seconds: 3600 },
  { label: '1 天', seconds: 86400 },
  { label: '7 天', seconds: 604800 },
];

Page({
  data: {
    kinds: KINDS,
    kindIndex: 0,
    expirations: EXPIRATIONS,
    expirationIndex: 0,
    teams: [],
    teamIndex: 0,
    submitting: false,
    form: { title: '', identifier: '', language: '', content: '' },
  },

  async onShow() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    const teams = app.globalData.teams || [];
    const teamIndex = Math.max(0, teams.findIndex((team) => team.teamId === app.globalData.activeTeamId));
    this.setData({ teams, teamIndex });
  },

  handleInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  handleKindChange(e) { this.setData({ kindIndex: Number(e.detail.value) }); },
  handleTeamChange(e) { this.setData({ teamIndex: Number(e.detail.value) }); },
  handleExpirationChange(e) { this.setData({ expirationIndex: Number(e.detail.value) }); },

  async handleSubmit() {
    const team = this.data.teams[this.data.teamIndex];
    const kind = this.data.kinds[this.data.kindIndex];
    const { title, identifier, language, content } = this.data.form;
    const expiration = this.data.expirations[this.data.expirationIndex];
    if (!team || !title.trim() || !content.trim()) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.createItem({
        teamId: team.teamId,
        kind: kind.value,
        title: title.trim(),
        identifier: identifier.trim(),
        language: kind.value === 'snippet' ? language.trim() : '',
        content,
        expiresAt: expiration.seconds ? new Date(Date.now() + expiration.seconds * 1000).toISOString() : undefined,
      });
      wx.showToast({ title: '已放入代码池', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
