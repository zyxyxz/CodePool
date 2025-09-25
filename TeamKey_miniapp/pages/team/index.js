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
  },

  async onShow() {
    await this.initialize();
  },

  async initialize() {
    const hasSession = app.globalData.token ? true : await app.tryRestoreSession();
    if (!hasSession && !app.globalData.token) {
      this.setData({ needsLogin: true, loading: false, members: [] });
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
      this.setData({ teams, teamIndex: teamIndex === -1 ? 0 : teamIndex, loading: false });
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
      this.setData({ members: [] });
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
    this.setData({ teamIndex }, () => {
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
    wx.showModal({
      title: '邀请成员',
      editable: true,
      placeholderText: '输入手机号或微信号',
      success: async (res) => {
        if (res.confirm && res.content) {
          try {
            await api.inviteMember(team.teamId, { invitee_contact: res.content, role: 'member' });
            wx.showToast({ title: '邀请已发送' });
          } catch (error) {
            wx.showToast({ title: '邀请失败', icon: 'none' });
          }
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
            const role = tapIndex === 0 ? 'admin' : tapIndex === 1 ? 'member' : 'visitor';
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
});
