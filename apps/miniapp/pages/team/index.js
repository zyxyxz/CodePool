const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    teams: [],
    teamIndex: 0,
    members: [],
    loading: true,
    needsLogin: false,
    loginLoading: false,
    shareInviteToken: '',
    shareInviteExpires: '',
    shareInviteExpiresText: '',
    loginProfile: app.getStoredProfile ? app.getStoredProfile() : {
      nickname: 'CodePool 用户',
      avatarUrl: '/assets/avatar-default.png',
    },
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      const profile = this.prepareLoginProfile();
      this.setData({ needsLogin: true, loading: false, members: [], loginProfile: profile });
      return;
    }
    this.setData({ needsLogin: false });
    await this.fetchTeams();
    await this.loadMembers();
  },

  async handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    try {
      app.setStoredProfile(this.data.loginProfile);
      await app.ensureLogin(true);
      this.setData({ needsLogin: false });
      await this.initialize();
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
      console.error(error);
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async fetchTeams() {
    this.setData({ loading: true });
    try {
      const teams = await api.fetchTeams();
      const active = app.globalData.activeTeamId || (teams[0] ? teams[0].teamId : null);
      const teamIndex = Math.max(0, teams.findIndex((t) => t.teamId === active));
      this.setData({
        teams,
        teamIndex: teamIndex === -1 ? 0 : teamIndex,
        loading: false,
        shareInviteToken: '',
        shareInviteExpires: '',
        shareInviteExpiresText: '',
      });
      if (teams.length > 0) {
        app.setActiveTeam(teams[this.data.teamIndex].teamId);
      }
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '加载团队失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async loadMembers() {
    const team = this.data.teams[this.data.teamIndex];
    if (!team) {
      this.setData({ members: [], teamIndex: 0 });
      return;
    }
    try {
      const members = await api.fetchTeamMembers(team.teamId);
      this.setData({ members });
    } catch (error) {
      wx.showToast({ title: '获取成员失败', icon: 'none' });
      console.error(error);
    }
  },

  handleTeamChange(e) {
    const teamIndex = Number(e.detail.value);
    this.setData({
      teamIndex,
      shareInviteToken: '',
      shareInviteExpires: '',
      shareInviteExpiresText: '',
    }, () => {
      const team = this.data.teams[teamIndex];
      if (team) {
        app.setActiveTeam(team.teamId);
        this.loadMembers();
      }
    });
  },

  async handleCreateTeam() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '新建团队',
      editable: true,
      placeholderText: '输入团队名称',
      success: async (res) => {
        if (res.confirm && res.content) {
          try {
            await api.createTeam({ name: res.content });
            wx.showToast({ title: '创建成功' });
            await app.tryRestoreSession();
            await this.fetchTeams();
            await this.loadMembers();
          } catch (error) {
            wx.showToast({ title: '创建失败', icon: 'none' });
          }
        }
      },
    });
  },

  async handleInvite() {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const team = this.data.teams[this.data.teamIndex];
    if (!team) return;
    wx.showActionSheet({
      itemList: ['微信转发邀请', '生成邀请码', '输入邀请码加入其他团队'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          this.presentInviteDuration('wechat');
        } else if (tapIndex === 1) {
          this.presentInviteDuration('code');
        } else if (tapIndex === 2) {
          this.handleEnterInviteCode();
        }
      },
    });
  },

  presentInviteDuration(mode) {
    const durations = [
      { label: '30 分钟', value: 30 },
      { label: '4 小时', value: 240 },
      { label: '1 天', value: 1440 },
      { label: '7 天', value: 10080 },
    ];
    wx.showActionSheet({
      itemList: durations.map((item) => item.label),
      success: ({ tapIndex }) => {
        const selected = durations[tapIndex];
        if (!selected) return;
        this.generateInvite(mode, selected.value);
      },
    });
  },

  async generateInvite(mode, minutes) {
    const team = this.data.teams[this.data.teamIndex];
    if (!team) return;
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const invite = await api.createTeamInvite(team.teamId, {
        mode,
        expires_in_minutes: minutes,
      });
      if (mode === 'wechat') {
        this.setData({
          shareInviteToken: invite.token,
          shareInviteExpires: invite.expires_at,
          shareInviteExpiresText: this.formatInviteTime(invite.expires_at),
        });
        wx.showShareMenu({ withShareTicket: true });
        wx.showModal({
          title: '邀请已生成',
          content: `有效期至：${this.formatInviteTime(invite.expires_at)}\n点击右上角或下方“转发”分享给队友。`,
          showCancel: false,
        });
      } else {
        wx.showModal({
          title: '邀请码',
          content: `邀请码：${invite.token}\n有效期至：${this.formatInviteTime(invite.expires_at)}`,
          confirmText: '复制邀请码',
          cancelText: '关闭',
          success: (res) => {
            if (res.confirm) {
              wx.setClipboardData({ data: invite.token });
            }
          },
        });
      }
    } catch (error) {
      console.error('generate invite', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleEnterInviteCode() {
    wx.showModal({
      title: '输入邀请码',
      editable: true,
      placeholderText: '请输入邀请码',
      success: async (res) => {
        if (!res.confirm || !res.content) {
          return;
        }
        try {
          const token = res.content.trim();
          if (!token) {
            wx.showToast({ title: '邀请码不能为空', icon: 'none' });
            return;
          }
          await api.acceptInvite(token);
          wx.showToast({ title: '加入成功', icon: 'success' });
          await app.tryRestoreSession();
          await this.fetchTeams();
          await this.loadMembers();
        } catch (error) {
          console.error('accept invite', error);
          wx.showToast({ title: '邀请码无效', icon: 'none' });
        }
      },
    });
  },

  handleMemberActions(e) {
    if (this.data.needsLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const { userid } = e.currentTarget.dataset;
    const team = this.data.teams[this.data.teamIndex];
    if (!team) return;
    wx.showActionSheet({
      itemList: ['设为管理员', '设为成员', '设为访客', '移除'],
      success: async ({ tapIndex }) => {
        try {
          if (tapIndex === 3) {
            await api.removeMember(team.teamId, userid);
          } else {
            const role = tapIndex === 0 ? 'admin' : tapIndex === 1 ? 'member' : 'guest';
            await api.updateMemberRole(team.teamId, userid, { role });
          }
          wx.showToast({ title: '操作成功' });
          this.loadMembers();
        } catch (error) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      },
    });
  },

  formatInviteTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  onShareAppMessage() {
    const token = this.data.shareInviteToken;
    const team = this.data.teams[this.data.teamIndex];
    if (token && team) {
      return {
        title: `邀请加入 ${team.name}`,
        path: `/pages/home/index?inviteToken=${token}`,
      };
    }
    return {
      title: 'CodePool 多端二步验证',
      path: '/pages/home/index',
    };
  },

  prepareLoginProfile() {
    if (typeof app.getStoredProfile === 'function') {
      const profile = app.getStoredProfile();
      this.setData({ loginProfile: profile });
      return profile;
    }
    const fallback = { nickname: 'CodePool 用户', avatarUrl: '/assets/avatar-default.png' };
    this.setData({ loginProfile: fallback });
    return fallback;
  },

  async handleChooseProfile() {
    try {
      const res = await wx.getUserProfile({ desc: '用于完善账号资料' });
      const profile = app.setStoredProfile({
        nickname: res.userInfo.nickName,
        avatarUrl: res.userInfo.avatarUrl,
        avatar_url: res.userInfo.avatarUrl,
      });
      this.setData({ loginProfile: profile });
      wx.showToast({ title: '已更新头像昵称', icon: 'none' });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
        wx.showToast({ title: '已取消授权', icon: 'none' });
      } else {
        wx.showToast({ title: '获取信息失败', icon: 'none' });
        console.error('profile choose failed', error);
      }
    }
  },
});
