const api = require('../../utils/api');
const {
  ROLE_LABELS,
  formatDate,
  friendlyError,
  isExpired,
} = require('../../utils/format');

const app = getApp();

function defaultProfile() {
  return app.getStoredProfile ? app.getStoredProfile() : {
    nickname: 'CodePool 用户',
    avatarUrl: '/assets/avatar-default.png',
  };
}

Page({
  data: {
    loading: true,
    error: '',
    offline: false,
    needsLogin: false,
    loginLoading: false,
    nicknameReviewPending: false,
    nicknameReviewInFlight: false,
    loginProfile: defaultProfile(),
    legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
    teams: [],
    teamIndex: 0,
    currentTeam: null,
    currentRoleLabel: '',
    canManage: false,
    members: [],
    invites: [],
    inviteToken: '',
    inviteRoleLabel: '',
    inviteExpiresText: '',
    inviteCreating: false,
  },

  onLoad() {
    this._approvedNickname = this.data.loginProfile.nickname;
  },

  async onShow() {
    await this.initialize();
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
    if (!hasSession) {
      const loginProfile = defaultProfile();
      this._approvedNickname = loginProfile.nickname;
      this.setData({
        loading: false,
        needsLogin: true,
        error: '',
        teams: [],
        members: [],
        invites: [],
        loginProfile,
        nicknameReviewPending: false,
        nicknameReviewInFlight: false,
        legalConsent: app.hasLegalConsent ? app.hasLegalConsent() : false,
      });
      return;
    }
    this.setData({ needsLogin: false });
    await this.loadTeams(options);
  },

  async loadTeams(options = {}) {
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const teams = await api.fetchTeams();
      app.globalData.teams = teams;
      let teamIndex = teams.findIndex((team) => team.teamId === app.globalData.activeTeamId);
      if (teamIndex < 0) teamIndex = 0;
      const currentTeam = teams[teamIndex] || null;
      if (currentTeam) app.setActiveTeam(currentTeam.teamId);
      const canManage = Boolean(currentTeam && (currentTeam.role === 'owner' || currentTeam.role === 'admin'));
      this.setData({
        teams,
        teamIndex,
        currentTeam,
        currentRoleLabel: currentTeam ? ROLE_LABELS[currentTeam.role] || currentTeam.role : '',
        canManage,
        loading: false,
        error: '',
        offline: false,
        inviteToken: '',
        inviteRoleLabel: '',
        inviteExpiresText: '',
      });
      await this.loadTeamData();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        app.logout();
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
    if (!team) {
      this.setData({ members: [], invites: [] });
      return;
    }
    try {
      const requests = [api.fetchTeamMembers(team.teamId)];
      if (this.data.canManage) requests.push(api.fetchTeamInvites(team.teamId));
      const results = await Promise.all(requests);
      const currentUserId = app.globalData.user && app.globalData.user.id;
      const members = results[0].map((member) => ({
        ...member,
        roleLabel: ROLE_LABELS[member.role] || member.role,
        joinedText: formatDate(member.joinedAt),
        expiresText: member.expiresAt ? formatDate(member.expiresAt) : '',
        isSelf: member.userId === currentUserId,
        manageable: this.data.canManage && member.role !== 'owner' && member.userId !== currentUserId,
      }));
      const invites = (results[1] || []).map((invite) => {
        const expired = isExpired(invite.expiresAt);
        return {
          ...invite,
          roleLabel: ROLE_LABELS[invite.role] || invite.role,
          expiresText: formatDate(invite.expiresAt),
          statusText: invite.usedAt ? '已使用' : expired ? '已过期' : '待领取',
          active: !invite.usedAt && !expired,
        };
      });
      this.setData({ members, invites });
    } catch (error) {
      this.setData({ error: friendlyError(error, '团队成员加载失败') });
    }
  },

  handleTeamChange(e) {
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
      inviteToken: '',
      inviteRoleLabel: '',
      inviteExpiresText: '',
    }, () => {
      if (currentTeam) app.setActiveTeam(currentTeam.teamId);
      this.loadTeamData();
    });
  },

  async handleCreateTeam() {
    if (!await app.guardMaintenance('创建团队')) return;
    const result = await wx.showModal({
      title: '创建团队代码池',
      editable: true,
      placeholderText: '2-48 个字符，例如：研发中心',
      confirmText: '创建',
    });
    if (!result.confirm) return;
    const name = (result.content || '').trim();
    if (name.length < 2 || name.length > 48) {
      wx.showToast({ title: '团队名称需为 2-48 个字符', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建中', mask: true });
    try {
      const team = await api.createTeam({ name });
      app.setActiveTeam(team.teamId);
      await this.loadTeams({ silent: true });
      wx.showToast({ title: '团队已创建', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '创建失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleInvite() {
    if (!this.data.canManage || this.data.inviteCreating) return;
    const roles = [
      { value: 'member', label: '成员', help: '可创建、查看和分享内容' },
      { value: 'guest', label: '访客', help: '仅可查看团队内容' },
      { value: 'admin', label: '管理员', help: '可管理成员和敏感内容' },
    ];
    wx.showActionSheet({
      itemList: roles.map((role) => `${role.label} · ${role.help}`),
      success: ({ tapIndex }) => {
        const role = roles[tapIndex];
        if (role) this.chooseInviteDuration(role);
      },
    });
  },

  chooseInviteDuration(role) {
    const durations = [
      { label: '1 小时', hours: 1 },
      { label: '4 小时', hours: 4 },
      { label: '24 小时', hours: 24 },
      { label: '7 天', hours: 168 },
    ];
    wx.showActionSheet({
      itemList: durations.map((duration) => duration.label),
      success: ({ tapIndex }) => {
        const duration = durations[tapIndex];
        if (duration) this.createInvite(role, duration);
      },
    });
  },

  async createInvite(role, duration) {
    const team = this.data.currentTeam;
    if (!team) return;
    if (!await app.guardMaintenance('创建团队邀请')) return;
    this.setData({ inviteCreating: true });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const invite = await api.createTeamInvite(team.teamId, {
        role: role.value,
        expiresInHours: duration.hours,
      });
      this.setData({
        inviteToken: invite.token,
        inviteRoleLabel: role.label,
        inviteExpiresText: formatDate(invite.expiresAt),
      });
      wx.showShareMenu({ withShareTicket: false });
      await this.loadTeamData();
      wx.showModal({
        title: '成员邀请已生成',
        content: `${role.label}权限，有效期至 ${formatDate(invite.expiresAt)}。请通过下方按钮转发，勿发送到公开群聊。`,
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '邀请创建失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ inviteCreating: false });
    }
  },

  handleCopyInvite() {
    if (this.data.inviteToken) wx.setClipboardData({ data: this.data.inviteToken });
  },

  async handleAcceptInvite() {
    if (!await app.guardMaintenance('领取团队邀请')) return;
    const result = await wx.showModal({
      title: '输入团队邀请码',
      editable: true,
      placeholderText: '粘贴队友发送的邀请码',
      confirmText: '验证并加入',
    });
    if (!result.confirm) return;
    const token = (result.content || '').trim();
    if (!token) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '验证中', mask: true });
    try {
      const accepted = await api.acceptInvite(token);
      if (accepted && accepted.teamId) app.setActiveTeam(accepted.teamId);
      await app.refreshMe();
      await this.loadTeams({ silent: true });
      wx.showToast({ title: '已加入团队', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '邀请码无效或已过期'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleMemberAction(e) {
    const userId = e.currentTarget.dataset.userid;
    const member = this.data.members.find((item) => item.userId === userId);
    if (!member || !member.manageable) return;
    wx.showActionSheet({
      itemList: ['设为管理员', '设为成员', '设为访客', '移出团队'],
      success: ({ tapIndex }) => {
        if (tapIndex === 3) this.confirmRemoveMember(member);
        else this.updateMemberRole(member, ['admin', 'member', 'guest'][tapIndex]);
      },
    });
  },

  async updateMemberRole(member, role) {
    if (!role || member.role === role) return;
    if (!await app.guardMaintenance('调整成员权限')) return;
    const roleLabel = ROLE_LABELS[role] || role;
    const confirm = await wx.showModal({
      title: '调整成员权限',
      content: `将「${member.nickname || '未命名成员'}」调整为${roleLabel}？`,
      confirmText: '确认调整',
    });
    if (!confirm.confirm) return;
    try {
      await api.updateMemberRole(this.data.currentTeam.teamId, member.userId, { role });
      await this.loadTeamData();
      wx.showToast({ title: '权限已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '权限调整失败'), icon: 'none' });
    }
  },

  async confirmRemoveMember(member) {
    const confirm = await wx.showModal({
      title: '移出团队？',
      content: `移出「${member.nickname || '未命名成员'}」后，对方将立即失去团队内容访问权限。`,
      confirmText: '移出团队',
      confirmColor: '#B42318',
    });
    if (!confirm.confirm) return;
    try {
      await api.removeMember(this.data.currentTeam.teamId, member.userId);
      await this.loadTeamData();
      wx.showToast({ title: '成员已移出', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '移除失败'), icon: 'none' });
    }
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    if (this.data.nicknameReviewPending) {
      wx.showToast({ title: '请等待昵称安全审核完成', icon: 'none' });
      return;
    }
    if (!this.data.legalConsent) {
      wx.showToast({ title: '请先勾选同意隐私政策和用户协议', icon: 'none' });
      return;
    }
    app.setStoredProfile(this.data.loginProfile);
    this.setData({ loginLoading: true });
    try {
      await app.ensureLogin(true);
      await this.initialize();
    } catch (error) {
      wx.showToast({ title: friendlyError(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  handleNicknameInput(e) {
    const nickname = e.detail.value;
    this.setData({
      'loginProfile.nickname': nickname,
      nicknameReviewPending: nickname.trim() !== String(this._approvedNickname || '').trim(),
    });
  },

  handleNicknameBlur() {
    const nickname = this.data.loginProfile.nickname;
    if (nickname.trim() === String(this._approvedNickname || '').trim()) {
      this.setData({ nicknameReviewPending: false, nicknameReviewInFlight: false });
      return;
    }
    this._reviewedNickname = nickname;
    this.setData({ nicknameReviewPending: true, nicknameReviewInFlight: true });
  },

  handleNicknameReview(e) {
    const reviewedNickname = this._reviewedNickname;
    if (!reviewedNickname || reviewedNickname !== this.data.loginProfile.nickname) {
      this.setData({ nicknameReviewInFlight: false });
      return;
    }
    if (e.detail && e.detail.pass === true) {
      this._approvedNickname = reviewedNickname;
      this._reviewedNickname = '';
      this.setData({ nicknameReviewPending: false, nicknameReviewInFlight: false });
      return;
    }
    const nickname = this._approvedNickname || defaultProfile().nickname;
    this._reviewedNickname = '';
    this.setData({ 'loginProfile.nickname': nickname, nicknameReviewPending: false, nicknameReviewInFlight: false });
    wx.showToast({ title: e.detail && e.detail.timeout ? '昵称审核超时，请重新输入' : '昵称未通过微信安全审核', icon: 'none' });
  },

  handleChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (!avatarUrl) return;
    app.setStoredProfile({ avatarUrl, avatar_url: avatarUrl, pendingAvatar: true });
    this.setData({
      'loginProfile.avatarUrl': avatarUrl,
      'loginProfile.avatar_url': avatarUrl,
      'loginProfile.pendingAvatar': true,
    });
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
    if (this.data.inviteToken && this.data.currentTeam) {
      return {
        title: `邀请你加入 ${this.data.currentTeam.name}`,
        path: `/pages/home/index?inviteToken=${encodeURIComponent(this.data.inviteToken)}`,
      };
    }
    return {
      title: 'CodePool · 团队安全代码池',
      path: '/pages/home/index',
    };
  },
});
