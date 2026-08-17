const api = require('../../../utils/api');
const { friendlyError } = require('../../../utils/format');

const app = getApp();
const DRAFT_KEY = 'CODEPOOL_ITEM_DRAFT';

const KINDS = [
  { label: '代码片段', value: 'snippet', help: '适合脚本、SQL、配置和可复用代码' },
  { label: '一次性代码', value: 'code', help: '适合短期口令、兑换码或恢复码' },
  { label: '敏感密文', value: 'secret', help: '适合临时凭证、密钥或内部信息' },
  { label: '团队备注', value: 'note', help: '适合操作步骤、值班说明和知识记录' },
];

const CREATE_EXPIRATIONS = [
  { label: '不过期', seconds: 0 },
  { label: '5 分钟', seconds: 300 },
  { label: '1 小时', seconds: 3600 },
  { label: '1 天', seconds: 86400 },
  { label: '7 天', seconds: 604800 },
];

const EMPTY_FORM = {
  title: '',
  identifier: '',
  language: '',
  content: '',
};

Page({
  data: {
    itemId: '',
    editing: false,
    loading: true,
    error: '',
    kinds: KINDS,
    kindIndex: 0,
    expirations: CREATE_EXPIRATIONS,
    expirationIndex: 0,
    teams: [],
    teamIndex: 0,
    submitting: false,
    maskContent: true,
    form: { ...EMPTY_FORM },
    contentLength: 0,
  },

  onLoad(options) {
    const itemId = options.id || '';
    const editing = Boolean(itemId);
    this.setData({
      itemId,
      editing,
      expirations: editing
        ? [{ label: '保持当前到期时间', seconds: null }, ...CREATE_EXPIRATIONS]
        : CREATE_EXPIRATIONS,
    });
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

  onHide() {
    this.saveDraft();
  },

  onUnload() {
    this.saveDraft();
  },

  async initialize() {
    this.setData({ loading: true, error: '' });
    try {
      const teams = app.globalData.teams.length ? app.globalData.teams : await api.fetchTeams();
      let teamIndex = teams.findIndex((team) => team.teamId === app.globalData.activeTeamId);
      if (teamIndex < 0) teamIndex = 0;
      this.setData({ teams, teamIndex });
      if (this.data.editing) {
        await this.loadItem();
      } else {
        this.restoreDraft();
      }
      this._ready = true;
      this.setData({ loading: false });
    } catch (error) {
      this.setData({ loading: false, error: friendlyError(error, '表单加载失败') });
    }
  },

  async loadItem() {
    const item = await api.fetchItem(this.data.itemId);
    const kindIndex = Math.max(0, KINDS.findIndex((kind) => kind.value === item.kind));
    const teamIndex = Math.max(0, this.data.teams.findIndex((team) => team.teamId === item.teamId));
    const form = {
      title: item.title || '',
      identifier: item.identifier || '',
      language: item.language || '',
      content: item.content || '',
    };
    this.setData({ kindIndex, teamIndex, form, contentLength: form.content.length });
    wx.setNavigationBarTitle({ title: '编辑共享内容' });
  },

  restoreDraft() {
    const draft = wx.getStorageSync(DRAFT_KEY);
    if (!draft || typeof draft !== 'object' || !draft.form) return;
    const form = { ...EMPTY_FORM, ...draft.form, content: '' };
    const kindIndex = KINDS[draft.kindIndex] ? draft.kindIndex : 0;
    const expirationIndex = CREATE_EXPIRATIONS[draft.expirationIndex] ? draft.expirationIndex : 0;
    this.setData({ form, kindIndex, expirationIndex, contentLength: form.content.length });
    wx.showToast({ title: '已恢复标题草稿，正文未缓存', icon: 'none' });
  },

  saveDraft() {
    if (this.data.editing || this._submitted) return;
    const form = this.data.form;
    const hasMetadata = form.title.trim() || form.identifier.trim() || form.language.trim();
    if (!hasMetadata) {
      wx.removeStorageSync(DRAFT_KEY);
      return;
    }
    wx.setStorageSync(DRAFT_KEY, {
      form: {
        title: form.title,
        identifier: form.identifier,
        language: form.language,
        content: '',
      },
      kindIndex: this.data.kindIndex,
      expirationIndex: this.data.expirationIndex,
      savedAt: Date.now(),
    });
  },

  handleInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const patch = { [`form.${field}`]: value };
    if (field === 'content') patch.contentLength = value.length;
    this.setData(patch);
  },

  handleKindChange(e) {
    if (this.data.editing) return;
    this.setData({ kindIndex: Number(e.detail.value) });
  },

  handleTeamChange(e) {
    if (this.data.editing) return;
    this.setData({ teamIndex: Number(e.detail.value) });
  },

  handleExpirationChange(e) {
    this.setData({ expirationIndex: Number(e.detail.value) });
  },

  handleMaskChange(e) {
    this.setData({ maskContent: e.detail.value });
  },

  async handlePaste() {
    try {
      const result = await wx.getClipboardData();
      const value = typeof result.data === 'string' ? result.data : '';
      if (!value) {
        wx.showToast({ title: '剪贴板没有文本', icon: 'none' });
        return;
      }
      const next = value.slice(0, 200000);
      this.setData({ 'form.content': next, contentLength: next.length });
    } catch (error) {
      wx.showToast({ title: '无法读取剪贴板', icon: 'none' });
    }
  },

  validate() {
    const team = this.data.teams[this.data.teamIndex];
    const title = this.data.form.title.trim();
    const content = this.data.form.content;
    if (!team) return '请选择团队代码池';
    if (!this.data.editing && team.role === 'guest') return '访客不能创建内容，请联系管理员';
    if (!title) return '请输入标题';
    if (title.length > 120) return '标题不能超过 120 个字符';
    if (!content.trim()) return '请输入共享内容';
    if (content.length > 200000) return '内容不能超过 20 万个字符';
    return '';
  },

  buildExpiration() {
    const selected = this.data.expirations[this.data.expirationIndex];
    if (!selected || selected.seconds === null) return undefined;
    if (selected.seconds === 0) return null;
    return new Date(Date.now() + selected.seconds * 1000).toISOString();
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    if (!await app.guardMaintenance(this.data.editing ? '保存修改' : '新增共享内容')) return;
    const validation = this.validate();
    if (validation) {
      wx.showToast({ title: validation, icon: 'none' });
      return;
    }
    const team = this.data.teams[this.data.teamIndex];
    const kind = this.data.kinds[this.data.kindIndex];
    const form = this.data.form;
    const expiresAt = this.buildExpiration();
    const payload = {
      title: form.title.trim(),
      identifier: form.identifier.trim(),
      language: kind.value === 'snippet' ? form.language.trim() : '',
      content: form.content,
    };
    if (expiresAt !== undefined) payload.expiresAt = expiresAt;
    this.setData({ submitting: true });
    try {
      if (this.data.editing) {
        await api.updateItem(this.data.itemId, payload, {
          preserveEmptyKeys: ['identifier', 'language'],
          preserveNullKeys: ['expiresAt'],
        });
      } else {
        await api.createItem({
          ...payload,
          teamId: team.teamId,
          kind: kind.value,
          metadata: {},
        });
      }
      this._submitted = true;
      wx.removeStorageSync(DRAFT_KEY);
      wx.showToast({ title: this.data.editing ? '修改已保存' : '已安全保存', icon: 'success' });
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
