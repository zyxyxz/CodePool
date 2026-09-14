const api = require('../../utils/api');
const { notifyNicknameReview } = require('../../utils/nickname');
const { copyText, readClipboard } = require('../../utils/clipboard');
const { TEAM_COLORS, normalizeThemeColor, getTheme, getThemeStyle, getThemeData, getActiveThemeColor, applyPageTheme } = require('../../utils/theme');
const {
  ROLE_LABELS,
  formatDate,
  friendlyError,
  isExpired,
} = require('../../utils/format');

const app = getApp();
const THEME_COLORS = TEAM_COLORS.map((value) => {
  const theme = getTheme(value);
  return { value, label: theme.label, accent: theme.accent, swatch: theme.tint, tint: theme.tint, bg: theme.bg };
});
const INVITE_ROLES = [
  { value: 'member', label: '成员', help: '可创建、查看和分享内容' },
  { value: 'guest', label: '访客', help: '仅可查看团队内容' },
  { value: 'admin', label: '管理员', help: '可管理成员和敏感内容' },
];
const INVITE_DURATIONS = [
  { label: '1 小时', hours: 1 },
  { label: '4 小时', hours: 4 },
  { label: '24 小时', hours: 24 },
  { label: '7 天', hours: 168 },
];

function validThemeColor(color) {
  return normalizeThemeColor(color);
}

function currentUserId() {
  return app.globalData.user && app.globalData.user.id || '';
}

function hasSameSession(userId) {
  return Boolean(userId && app.globalData.token && currentUserId() === userId);
}

function defaultProfile() {
  return app.getStoredProfile ? app.getStoredProfile() : {
    nickname: 'CodePool 用户',
    avatarUrl: '/assets/avatar-default.png',
  };
}

module.exports = function createTeamPage(detail = false) { return {
  data: {
    ...getThemeData(),
    isDetail: detail,
    activeTeamId: '',
    loading: true,
    error: '',
    offline: false,
    needsLogin: false,
    loginLoading: false,
    avatarProcessing: false,
    loginProfile: defaultProfile(),
    legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
    teams: [],
    teamIndex: 0,
    currentTeam: null,
    currentRoleLabel: '',
    canManage: false,
    members: [],
    invites: [],
    teamDataLoading: false,
    teamDataError: '',
    inviteToken: '',
    inviteRoleLabel: '',
    inviteExpiresText: '',
    inviteStatusText: '',
    inviteUsable: false,
    inviteCreating: false,
    inviteCopying: false,
    inviteComposerOpen: false,
    inviteRoles: INVITE_ROLES,
    inviteDurations: INVITE_DURATIONS,
    selectedInviteRole: 'member',
    selectedInviteHours: 24,
    inviteError: '',
    teamEditorOpen: false,
    teamSaving: false,
    teamNameDraft: '',
    teamColorDraft: '#15803D',
    teamPreviewTheme: getTheme(),
    teamPreviewStyle: getThemeStyle(),
    teamEditError: '',
    themeColors: THEME_COLORS,
    joinOpen: false,
    joinToken: '',
    joinError: '',
    joinLoading: false,
    joinPasting: false,
  },

  onLoad(options = {}) {
    this._detailTeamId = detail ? options.teamId || '' : null;
  },

  async onShow() {
    if (detail) {
      applyPageTheme(this, this.data.currentTeam ? this.data.currentTeam.themeColor : getActiveThemeColor(app));
      await this.initialize();
      return;
    }
    const teams = app.globalData.teams || [];
    const teamIndex = teams.findIndex((entry) => entry.teamId === app.globalData.activeTeamId);
    const currentTeam = teams[teamIndex] || null;
    if ((this.data.currentTeam && this.data.currentTeam.teamId) !== (currentTeam && currentTeam.teamId)) {
      this._teamDataSequence = (this._teamDataSequence || 0) + 1;
      this.clearInviteExpiryTimer();
      this.setData({ teams, teamIndex: Math.max(0, teamIndex), currentTeam, members: [], invites: [], inviteToken: '', inviteUsable: false, teamEditorOpen: false, inviteComposerOpen: false, loading: true });
    }
    applyPageTheme(this, getActiveThemeColor(app));
    await this.initialize();
  },

  onHide() {
    this.clearInviteExpiryTimer();
  },

  onUnload() {
    this._teamLoadSequence = (this._teamLoadSequence || 0) + 1;
    this._teamDataSequence = (this._teamDataSequence || 0) + 1;
    this.clearInviteExpiryTimer();
    this._generatedInvites = {};
  },

  async onPullDownRefresh() {
    try {
      await this.initialize({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initialize(options = {}) {
    const hasSession = await app.awaitReady();
    this.ensureInviteOwner();
    if (!hasSession) {
      this._generatedInvites = {};
      this.clearInviteExpiryTimer();
      const loginProfile = defaultProfile();
      this.setData({
        loading: false,
        needsLogin: true,
        error: '',
        teams: [],
        members: [],
        invites: [],
        currentTeam: null,
        canManage: false,
        inviteToken: '',
        inviteUsable: false,
        teamEditorOpen: false,
        inviteComposerOpen: false,
        joinOpen: false,
        teamSaving: false,
        inviteCreating: false,
        joinLoading: false,
        loginProfile,
        legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
      });
      return;
    }
    this.setData({ needsLogin: false });
    await this.loadTeams(options);
  },

  async loadTeams(options = {}) {
    this.ensureInviteOwner();
    const userId = currentUserId();
    const sequence = (this._teamLoadSequence || 0) + 1;
    this._teamLoadSequence = sequence;
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const teams = (await api.fetchTeams()).map((team) => ({ ...team, themeColor: validThemeColor(team.themeColor), cardStyle: getThemeStyle(team.themeColor), roleLabel: ROLE_LABELS[team.role] || team.role }));
      if (!hasSameSession(userId) || sequence !== this._teamLoadSequence) return;
      app.globalData.teams = teams;
      let teamIndex = teams.findIndex((team) => team.teamId === (detail ? this._detailTeamId : app.globalData.activeTeamId));
      if (teamIndex < 0 && !detail) teamIndex = 0;
      const currentTeam = teams[teamIndex] || null;
      if (!detail) app.setActiveTeam(currentTeam ? currentTeam.teamId : null);
      const canManage = Boolean(currentTeam && (currentTeam.role === 'owner' || currentTeam.role === 'admin'));
      this.setData({
        teams,
        teamIndex,
        activeTeamId: app.globalData.activeTeamId || '',
        currentTeam,
        currentRoleLabel: currentTeam ? ROLE_LABELS[currentTeam.role] || currentTeam.role : '',
        canManage,
        loading: false,
        error: '',
        offline: false,
      });
      applyPageTheme(this, currentTeam ? currentTeam.themeColor : null);
      if (detail) {
        if (!currentTeam) {
          this.setData({ error: '该团队已不可访问，可能已退出或权限已变更。请返回团队列表。', members: [], invites: [], inviteToken: '', inviteUsable: false });
          return;
        }
        this.applyGeneratedInvite();
        await this.loadTeamData();
      }
    } catch (error) {
      if (!hasSameSession(userId) || sequence !== this._teamLoadSequence) return;
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
        this.ensureInviteOwner();
        this.setData({ loading: false, needsLogin: true, error: '' });
        return;
      }
      this.setData({
        loading: false,
        error: friendlyError(error, '团队信息加载失败'),
        offline: Boolean(error.offline),
      });
    }
  },

  async loadTeamData() {
    const team = this.data.currentTeam;
    const userId = currentUserId();
    if (!team) {
      this.setData({ members: [], invites: [], teamDataLoading: false, teamDataError: '' });
      return;
    }
    const sequence = (this._teamDataSequence || 0) + 1;
    this._teamDataSequence = sequence;
    const canManage = this.data.canManage;
    this.setData({ teamDataLoading: true, teamDataError: '' });
    try {
      const requests = [api.fetchTeamMembers(team.teamId)];
      if (canManage) requests.push(api.fetchTeamInvites(team.teamId));
      const results = await Promise.all(requests);
      if (!hasSameSession(userId) || sequence !== this._teamDataSequence || !this.data.currentTeam || this.data.currentTeam.teamId !== team.teamId) return;
      const currentUserId = app.globalData.user && app.globalData.user.id;
      const members = results[0].map((member) => ({
        ...member,
        roleLabel: ROLE_LABELS[member.role] || member.role,
        joinedText: formatDate(member.joinedAt),
        expiresText: member.expiresAt ? formatDate(member.expiresAt) : '',
        isSelf: member.userId === currentUserId,
        manageable: canManage && member.role !== 'owner' && member.userId !== currentUserId,
      }));
      const invites = (results[1] || []).map((invite) => {
        const expired = isExpired(invite.expiresAt);
        return {
          ...invite,
          roleLabel: ROLE_LABELS[invite.role] || invite.role,
          expiresText: formatDate(invite.expiresAt),
          statusText: invite.revokedAt ? '已撤销' : invite.usedAt ? '已使用' : expired ? '已过期' : '待领取',
          active: !invite.revokedAt && !invite.usedAt && !expired,
        };
      });
      this.setData({ members, invites });
      this.applyGeneratedInvite(invites);
    } catch (error) {
      if (hasSameSession(userId) && sequence === this._teamDataSequence && this.data.currentTeam && this.data.currentTeam.teamId === team.teamId) {
        this.setData({ teamDataError: friendlyError(error, '成员与邀请暂时无法同步') });
      }
    } finally {
      if (hasSameSession(userId) && sequence === this._teamDataSequence) this.setData({ teamDataLoading: false });
    }
  },

  handleTeamChange(e) {
    if (this.data.teamSaving || this.data.inviteCreating) return;
    const teamIndex = Number(e.detail.value);
    const currentTeam = this.data.teams[teamIndex] || null;
    const canManage = Boolean(currentTeam && (currentTeam.role === 'owner' || currentTeam.role === 'admin'));
    this.setData({
      teamIndex,
      currentTeam,
      currentRoleLabel: currentTeam ? ROLE_LABELS[currentTeam.role] || currentTeam.role : '',
      canManage,
      members: [],
      invites: [],
      teamDataError: '',
      teamEditorOpen: false,
      inviteComposerOpen: false,
    }, () => {
      app.setActiveTeam(currentTeam ? currentTeam.teamId : null);
      applyPageTheme(this, currentTeam ? currentTeam.themeColor : null);
      this.applyGeneratedInvite();
      this.loadTeamData();
    });
  },

  handleEditTeam() {
    this.ensureInviteOwner();
    const team = this.data.currentTeam;
    if (!team || !this.data.canManage) return;
    this._editingTeamId = team.teamId;
    this.setData({
      teamEditorOpen: true,
      teamNameDraft: team.name,
      teamColorDraft: validThemeColor(team.themeColor),
      teamPreviewTheme: getTheme(team.themeColor),
      teamPreviewStyle: getThemeStyle(team.themeColor),
      teamEditError: '',
    });
  },

  handleCloseTeamEditor() {
    if (!this.data.teamSaving) this.setData({ teamEditorOpen: false });
  },

  handleTeamNameInput(e) {
    this.setData({ teamNameDraft: e.detail.value, teamEditError: '' });
  },

  handleThemeChange(e) {
    if (this.data.teamSaving) return;
    const color = validThemeColor(e.currentTarget.dataset.color);
    this.setData({ teamColorDraft: color, teamPreviewTheme: getTheme(color), teamPreviewStyle: getThemeStyle(color) });
  },

  async handleSaveTeam(e) {
    const team = this.data.currentTeam;
    const userId = currentUserId();
    if (this.data.teamSaving || !team || !this.data.canManage || team.teamId !== this._editingTeamId) return;
    const submittedName = e && e.detail && e.detail.value && e.detail.value.teamName;
    const name = String(submittedName === undefined ? this.data.teamNameDraft : submittedName).trim();
    if (name.length < 2 || name.length > 48) {
      this.setData({ teamEditError: '团队名称需为 2-48 个字符' });
      return;
    }
    const themeColor = validThemeColor(this.data.teamColorDraft);
    this.setData({ teamSaving: true, teamEditError: '' });
    try {
      if (!await app.guardMaintenance('编辑团队')) return;
      if (!hasSameSession(userId)) return;
      const updated = await api.updateTeam(team.teamId, { name, themeColor });
      if (!hasSameSession(userId)) return;
      this._teamLoadSequence = (this._teamLoadSequence || 0) + 1;
      const teams = this.data.teams.map((item) => item.teamId === team.teamId ? { ...item, ...updated, name, themeColor } : item);
      app.globalData.teams = teams;
      const currentTeam = this.data.currentTeam && this.data.currentTeam.teamId === team.teamId
        ? teams.find((item) => item.teamId === team.teamId)
        : this.data.currentTeam;
      this.setData({ teams, currentTeam, teamEditorOpen: false, loading: false });
      app.setActiveTeam(app.globalData.activeTeamId);
      applyPageTheme(this, currentTeam ? currentTeam.themeColor : null);
      wx.showToast({ title: '团队设置已更新', icon: 'success' });
    } catch (error) {
      if (hasSameSession(userId)) this.setData({ teamEditError: friendlyError(error, '保存失败，请重试') });
    } finally {
      if (hasSameSession(userId)) this.setData({ teamSaving: false });
    }
  },

  handleSheetTap() {},

  handleOpenTeam(e) {
    const teamId = e.currentTarget.dataset.teamid;
    if (!this.data.teams.some((team) => team.teamId === teamId)) return;
    wx.navigateTo({ url: `/pages/team/detail?teamId=${encodeURIComponent(teamId)}` });
  },

  handleEnterWorkspace() {
    if (!this.data.currentTeam || this.data.error) return;
    app.setActiveTeam(this.data.currentTeam.teamId);
    wx.switchTab({ url: '/pages/home/index' });
  },

  handleBackToTeams() {
    wx.switchTab({ url: '/pages/team/index' });
  },

  handleAddTeam() {
    if (detail) return;
    wx.showActionSheet({
      itemList: ['创建团队', '加入团队'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.handleCreateTeam();
        if (tapIndex === 1) this.handleAcceptInvite();
      },
    });
  },

  async handleCreateTeam() {
    if (detail || this._creatingTeam) return;
    const userId = currentUserId();
    if (!await app.guardMaintenance('创建团队')) return;
    const result = await wx.showModal({
      title: '创建团队空间',
      editable: true,
      placeholderText: '2-48 个字符，例如：研发中心',
      confirmText: '创建',
    });
    if (!result.confirm || !hasSameSession(userId)) return;
    const name = (result.content || '').trim();
    if (name.length < 2 || name.length > 48) {
      wx.showToast({ title: '团队名称需为 2-48 个字符', icon: 'none' });
      return;
    }
    this._creatingTeam = true;
    wx.showLoading({ title: '创建中', mask: true });
    try {
      const team = await api.createTeam({ name });
      if (!hasSameSession(userId)) return;
      await this.loadTeams({ silent: true });
      wx.showToast({ title: '团队已创建', icon: 'success' });
      if (hasSameSession(userId)) wx.navigateTo({ url: `/pages/team/detail?teamId=${encodeURIComponent(team.teamId)}` });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '创建失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this._creatingTeam = false;
    }
  },

  handleInvite() {
    this.ensureInviteOwner();
    if (!this.data.canManage || this.data.inviteCreating) return;
    this.setData({
      inviteComposerOpen: true,
      selectedInviteRole: 'member',
      selectedInviteHours: 24,
      inviteError: '',
    });
  },

  handleCloseInviteComposer() {
    if (!this.data.inviteCreating) this.setData({ inviteComposerOpen: false });
  },

  handleInviteRoleChange(e) {
    const role = e.currentTarget.dataset.role;
    if (!this.data.inviteCreating && INVITE_ROLES.some((item) => item.value === role)) {
      this.setData({ selectedInviteRole: role, inviteError: '' });
    }
  },

  handleInviteDurationChange(e) {
    const hours = Number(e.currentTarget.dataset.hours);
    if (!this.data.inviteCreating && INVITE_DURATIONS.some((item) => item.hours === hours)) {
      this.setData({ selectedInviteHours: hours, inviteError: '' });
    }
  },

  async handleGenerateInvite() {
    this.ensureInviteOwner();
    const team = this.data.currentTeam;
    const userId = currentUserId();
    if (!team || !this.data.canManage || this.data.inviteCreating) return;
    const role = INVITE_ROLES.find((item) => item.value === this.data.selectedInviteRole);
    const duration = INVITE_DURATIONS.find((item) => item.hours === this.data.selectedInviteHours);
    if (!role || !duration) return;
    this.setData({ inviteCreating: true, inviteError: '' });
    try {
      if (!await app.guardMaintenance('创建团队邀请')) return;
      if (!hasSameSession(userId)) return;
      const invite = await api.createTeamInvite(team.teamId, {
        role: role.value,
        expiresInHours: duration.hours,
      });
      if (!hasSameSession(userId)) return;
      if (!invite.token || !Number.isFinite(Date.parse(invite.expiresAt))) throw new Error('邀请码未完整生成，请重试');
      this.ensureInviteOwner();
      this._generatedInvites = this._generatedInvites || {};
      this._generatedInvites[team.teamId] = { ...invite, teamId: team.teamId, role: role.value };
      this.setData({ inviteComposerOpen: false });
      this.applyGeneratedInvite();
      if (typeof wx.showShareMenu === 'function') wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] });
      if (this.data.currentTeam && this.data.currentTeam.teamId === team.teamId) await this.loadTeamData();
      wx.showToast({ title: '邀请码已生成', icon: 'success' });
    } catch (error) {
      if (hasSameSession(userId)) this.setData({ inviteError: friendlyError(error, '邀请创建失败，请重试') });
    } finally {
      if (hasSameSession(userId)) this.setData({ inviteCreating: false });
    }
  },

  clearInviteExpiryTimer() {
    if (this._inviteExpiryTimer) clearTimeout(this._inviteExpiryTimer);
    this._inviteExpiryTimer = null;
  },

  ensureInviteOwner() {
    const ownerId = app.globalData.token ? currentUserId() : '';
    if (this._inviteOwnerId === ownerId) return;
    const changedIdentity = this._inviteOwnerId !== undefined;
    this._inviteOwnerId = ownerId;
    this._generatedInvites = {};
    this.clearInviteExpiryTimer();
    this.setData({
      inviteToken: '', inviteUsable: false, inviteStatusText: '',
      inviteComposerOpen: false, inviteCreating: false, inviteCopying: false,
      teamEditorOpen: false, teamSaving: false,
      joinOpen: false, joinLoading: false, joinPasting: false, joinToken: '',
      ...(changedIdentity ? { teams: [], currentTeam: null, canManage: false, members: [], invites: [], teamDataError: '' } : {}),
    });
  },

  applyGeneratedInvite(invites) {
    this.ensureInviteOwner();
    this.clearInviteExpiryTimer();
    const team = this.data.currentTeam;
    const generated = team && this.data.canManage && this._generatedInvites && this._generatedInvites[team.teamId];
    if (!generated) {
      this.setData({ inviteToken: '', inviteRoleLabel: '', inviteExpiresText: '', inviteStatusText: '', inviteUsable: false });
      return;
    }
    if (invites) {
      const latest = invites.find((item) => item.id === generated.id);
      if (latest) Object.assign(generated, { usedAt: latest.usedAt, revokedAt: latest.revokedAt });
    }
    const expiresAt = Date.parse(generated.expiresAt);
    const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
    const usable = !expired && !generated.usedAt && !generated.revokedAt;
    this.setData({
      inviteToken: generated.token,
      inviteRoleLabel: ROLE_LABELS[generated.role] || generated.role,
      inviteExpiresText: formatDate(generated.expiresAt),
      inviteStatusText: generated.revokedAt ? '已撤销' : generated.usedAt ? '已使用' : expired ? '已过期' : '待领取',
      inviteUsable: usable,
    });
    if (usable) this._inviteExpiryTimer = setTimeout(() => this.applyGeneratedInvite(), Math.max(1, expiresAt - Date.now()));
  },

  async handleCopyInvite() {
    if (this.data.inviteCopying) return;
    this.applyGeneratedInvite();
    if (!this.data.inviteUsable) {
      wx.showToast({ title: '此邀请已失效，请重新生成', icon: 'none' });
      return;
    }
    this.setData({ inviteCopying: true });
    try {
      await copyText(this.data.inviteToken, { successMessage: '邀请码已复制' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '邀请码复制失败，请重试'), icon: 'none' });
    } finally {
      this.setData({ inviteCopying: false });
    }
  },

  handleAcceptInvite() {
    if (detail) return;
    this.setData({ joinOpen: true, joinToken: '', joinError: '' });
  },

  handleCloseJoin() {
    if (!this.data.joinLoading && !this.data.joinPasting) this.setData({ joinOpen: false });
  },

  handleJoinTokenInput(e) {
    this.setData({ joinToken: e.detail.value, joinError: '' });
  },

  async handlePasteJoin() {
    const userId = currentUserId();
    if (this.data.joinLoading || this.data.joinPasting) return;
    this.setData({ joinPasting: true, joinError: '' });
    try {
      const token = String(await readClipboard()).trim();
      if (!hasSameSession(userId)) return;
      if (!token) throw new Error('剪贴板为空，请先复制邀请码');
      this.setData({ joinToken: token });
      wx.showToast({ title: '邀请码已粘贴', icon: 'success' });
    } catch (error) {
      if (hasSameSession(userId)) this.setData({ joinError: friendlyError(error, '无法读取剪贴板，请手动粘贴') });
    } finally {
      if (hasSameSession(userId)) this.setData({ joinPasting: false });
    }
  },

  async handleJoinTeam(e) {
    const userId = currentUserId();
    if (this.data.joinLoading || this.data.joinPasting) return;
    const submitted = e && e.detail && e.detail.value && e.detail.value.inviteToken;
    const token = String(submitted === undefined ? this.data.joinToken : submitted).trim();
    if (!token) {
      this.setData({ joinError: '请输入邀请码' });
      return;
    }
    this.setData({ joinLoading: true, joinError: '' });
    try {
      if (!await app.guardMaintenance('领取团队邀请')) return;
      if (!hasSameSession(userId)) return;
      const accepted = await api.acceptInvite(token);
      if (!hasSameSession(userId)) return;
      this.setData({ joinOpen: false, joinToken: '' });
      await app.refreshMe();
      await this.loadTeams({ silent: true });
      wx.showToast({ title: '已加入团队', icon: 'success' });
      if (hasSameSession(userId) && accepted && accepted.teamId) wx.navigateTo({ url: `/pages/team/detail?teamId=${encodeURIComponent(accepted.teamId)}` });
    } catch (error) {
      if (!hasSameSession(userId)) return;
      const message = friendlyError(error, '邀请码无效或已过期');
      if (this.data.joinOpen) this.setData({ joinError: message });
      else wx.showToast({ title: message, icon: 'none' });
    } finally {
      if (hasSameSession(userId)) this.setData({ joinLoading: false });
    }
  },

  handleMemberAction(e) {
    const team = this.data.currentTeam;
    if (!team) return;
    const userId = e.currentTarget.dataset.userid;
    const member = this.data.members.find((item) => item.userId === userId);
    if (!member || !member.manageable) return;
    const selectedMember = { ...member, teamId: team.teamId, teamName: team.name };
    const actorId = currentUserId();
    wx.showActionSheet({
      itemList: ['设为管理员', '设为成员', '设为访客', '移出团队'],
      success: ({ tapIndex }) => {
        if (!hasSameSession(actorId)) return;
        if (tapIndex === 3) this.confirmRemoveMember(selectedMember);
        else this.updateMemberRole(selectedMember, ['admin', 'member', 'guest'][tapIndex]);
      },
    });
  },

  async updateMemberRole(member, role) {
    if (!role || member.role === role) return;
    const teamId = member.teamId || this.data.currentTeam && this.data.currentTeam.teamId;
    const teamName = member.teamName || this.data.currentTeam && this.data.currentTeam.name || '原团队';
    const actorId = currentUserId();
    if (!teamId) return;
    if (!await app.guardMaintenance('调整成员权限')) return;
    if (!hasSameSession(actorId)) return;
    const roleLabel = ROLE_LABELS[role] || role;
    const confirm = await wx.showModal({
      title: '调整成员权限',
      content: `将「${member.nickname || '未命名成员'}」在「${teamName}」的权限调整为${roleLabel}？`,
      confirmText: '确认调整',
    });
    if (!confirm.confirm || !hasSameSession(actorId)) return;
    try {
      await api.updateMemberRole(teamId, member.userId, { role });
      if (!hasSameSession(actorId)) return;
      if (this.data.currentTeam && this.data.currentTeam.teamId === teamId) await this.loadTeamData();
      wx.showToast({ title: '权限已更新', icon: 'success' });
    } catch (error) {
      if (hasSameSession(actorId)) wx.showToast({ title: friendlyError(error, '权限调整失败'), icon: 'none' });
    }
  },

  async confirmRemoveMember(member) {
    const teamId = member.teamId || this.data.currentTeam && this.data.currentTeam.teamId;
    const teamName = member.teamName || this.data.currentTeam && this.data.currentTeam.name || '原团队';
    const actorId = currentUserId();
    if (!teamId) return;
    const confirm = await wx.showModal({
      title: '移出团队？',
      content: `从「${teamName}」移出「${member.nickname || '未命名成员'}」后，对方将立即失去该团队的访问权限。`,
      confirmText: '移出团队',
      confirmColor: '#B42318',
    });
    if (!confirm.confirm || !hasSameSession(actorId)) return;
    try {
      await api.removeMember(teamId, member.userId);
      if (!hasSameSession(actorId)) return;
      if (this.data.currentTeam && this.data.currentTeam.teamId === teamId) await this.loadTeamData();
      wx.showToast({ title: '成员已移出', icon: 'success' });
    } catch (error) {
      if (hasSameSession(actorId)) wx.showToast({ title: friendlyError(error, '移除失败'), icon: 'none' });
    }
  },

  async handleLogin(e) {
    if (this.data.loginLoading || this.data.avatarProcessing) return;
    if (!this.data.legalConsent) {
      wx.showToast({ title: '请先勾选同意隐私政策和用户协议', icon: 'none' });
      return;
    }
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      if (app.needsProfileSetup && app.needsProfileSetup()) return;
      await this.initialize();
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  handleNicknameReview: notifyNicknameReview,

  async storeChosenAvatar(tempFilePath) {
    const avatarUrl = await app.persistAvatarFile(tempFilePath);
    app.setStoredProfile({ avatarUrl, avatar_url: avatarUrl, pendingAvatar: true });
    this.setData({
      'loginProfile.avatarUrl': avatarUrl,
      'loginProfile.avatar_url': avatarUrl,
      'loginProfile.pendingAvatar': true,
    });
  },

  async handleChooseAvatar(e) {
    const tempFilePath = e.detail && e.detail.avatarUrl;
    if (!tempFilePath || this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      await this.storeChosenAvatar(tempFilePath);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '头像选择失败'), icon: 'none' });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },

  async handleChooseAvatarFallback() {
    if (this.data.avatarProcessing) return;
    this.setData({ avatarProcessing: true });
    try {
      const tempFilePath = await app.chooseAvatarImage();
      if (tempFilePath) await this.storeChosenAvatar(tempFilePath);
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '头像选择失败'), icon: 'none' });
    } finally {
      this.setData({ avatarProcessing: false });
    }
  },

  handleLegalConsent(e) {
    const accepted = (e.detail.value || []).indexOf('agree') !== -1;
    app.setLegalConsent(accepted);
    this.setData({ legalConsent: accepted });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },

  handleRetry() {
    this.initialize();
  },

  onShareAppMessage() {
    this.applyGeneratedInvite();
    if (this.data.inviteUsable && this.data.currentTeam) {
      return {
        title: `邀请你加入 ${this.data.currentTeam.name}`,
        path: `/pages/home/index?inviteToken=${encodeURIComponent(this.data.inviteToken)}`,
      };
    }
    return {
      title: 'CodePool · 团队密钥钱包',
      path: '/pages/home/index',
    };
  },
}; };
