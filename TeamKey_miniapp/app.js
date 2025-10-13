const api = require('./utils/api');

const DEFAULT_PROFILE = {
  nickname: 'TeamKey 用户',
  avatarUrl: '/assets/avatar-default.png',
  avatar_url: '/assets/avatar-default.png',
};

const normalizeTeams = (teams = []) => {
  return (teams || []).map((item) => ({
    ...item,
    teamId: item.teamId ?? item.team_id ?? item.teamID,
    team_id: item.team_id ?? item.teamId ?? item.teamID,
    ownerId: item.ownerId ?? item.owner_id,
    owner_id: item.owner_id ?? item.ownerId,
    createdAt: item.createdAt ?? item.created_at,
    created_at: item.created_at ?? item.createdAt,
  }));
};

App({
  globalData: {
    user: null,
    token: '',
    teams: [],
    activeTeamId: null,
    pendingInviteToken: null,
    profile: { ...DEFAULT_PROFILE },
  },

  onLaunch(options) {
    const inviteToken = options?.query?.inviteToken;
    if (inviteToken) {
      this.globalData.pendingInviteToken = inviteToken;
    }
    this.tryRestoreSession();
  },

  onShow(options) {
    const inviteToken = options?.query?.inviteToken;
    if (inviteToken) {
      this.globalData.pendingInviteToken = inviteToken;
      if (this.globalData.token) {
        this.consumePendingInvite();
      }
    }
  },

  async tryRestoreSession() {
    const storedToken = wx.getStorageSync('TEAMKEY_TOKEN');
    if (!storedToken) {
      this.logout(false);
      return false;
    }
    api.setToken(storedToken);
    this.globalData.token = storedToken;
    this.globalData.profile = this.getStoredProfile();
    try {
      const me = await api.fetchMe();
      this.globalData.user = me.user;
      const normalizedTeams = normalizeTeams(me.teams);
      this.globalData.teams = normalizedTeams;
      wx.setStorageSync('TEAMKEY_PROFILE', {
        open_id: me.user?.open_id || me.user?.openId,
        openId: me.user?.open_id || me.user?.openId,
        nickname: me.user?.nickname,
        avatar_url: me.user?.avatarUrl || me.user?.avatar_url,
      });
      this.globalData.profile = this.getStoredProfile();
      this.globalData.activeTeamId = normalizedTeams[0] ? normalizedTeams[0].teamId : null;
      await this.consumePendingInvite();
      return true;
    } catch (error) {
      console.warn('Restore session failed', error);
      this.logout();
      return false;
    }
  },

  async ensureLogin(force = false) {
    if (this.globalData.token && !force) {
      return this.globalData.token;
    }
    const loginResult = await wx.login();
    if (!loginResult.code) {
      throw new Error(loginResult.errMsg || '微信登录失败');
    }
    const profile = this.getStoredProfile();
    const { token, user } = await api.login(loginResult.code, profile);
    api.setToken(token);
    wx.setStorageSync('TEAMKEY_TOKEN', token);
    wx.setStorageSync('TEAMKEY_PROFILE', {
      open_id: user.openId || user.open_id,
      openId: user.openId || user.open_id,
      nickname: user.nickname,
      avatar_url: user.avatarUrl || user.avatar_url,
    });
    this.globalData.profile = this.getStoredProfile();
    this.globalData.token = token;
    this.globalData.user = user;
    const me = await api.fetchMe();
    this.globalData.user = me.user;
    const normalizedTeams = normalizeTeams(me.teams);
    this.globalData.teams = normalizedTeams;
    this.globalData.activeTeamId = normalizedTeams[0] ? normalizedTeams[0].teamId : null;
    await this.consumePendingInvite();
    return token;
  },

  setActiveTeam(teamId) {
    this.globalData.activeTeamId = teamId;
  },

  async consumePendingInvite() {
    const token = this.globalData.pendingInviteToken;
    if (!token || !this.globalData.token || this._consumingInvite) {
      return;
    }
    this._consumingInvite = true;
    try {
      const summary = await api.acceptInvite(token);
      const me = await api.fetchMe();
      const normalizedTeams = normalizeTeams(me.teams);
      this.globalData.user = me.user;
      this.globalData.teams = normalizedTeams;
      const activeTeamId = normalizedTeams.find((t) => t.teamId === summary.team_id)?.teamId || summary.team_id;
      this.globalData.activeTeamId = activeTeamId;
      wx.showToast({ title: '已加入新团队', icon: 'success' });
    } catch (error) {
      console.warn('consume invite failed', error);
      wx.showToast({ title: '邀请无效或已过期', icon: 'none' });
    } finally {
      this.globalData.pendingInviteToken = null;
      this._consumingInvite = false;
    }
  },

  logout(clearStorage = true) {
    this.globalData = {
      user: null,
      token: '',
      teams: [],
      activeTeamId: null,
      pendingInviteToken: null,
      profile: { ...DEFAULT_PROFILE },
    };
    api.setToken('');
    if (clearStorage) {
      wx.removeStorageSync('TEAMKEY_TOKEN');
    }
  },

  getStoredProfile() {
    const stored = wx.getStorageSync('TEAMKEY_PROFILE') || {};
    const avatar = stored.avatar_url || stored.avatarUrl;
    const nickname = stored.nickname;
    const profile = {
      ...DEFAULT_PROFILE,
      ...stored,
      nickname: nickname && nickname.trim() ? nickname.trim() : DEFAULT_PROFILE.nickname,
      avatarUrl: avatar && avatar.trim() ? avatar.trim() : DEFAULT_PROFILE.avatarUrl,
      avatar_url: avatar && avatar.trim() ? avatar.trim() : DEFAULT_PROFILE.avatar_url,
    };
    wx.setStorageSync('TEAMKEY_PROFILE', profile);
    return profile;
  },

  setStoredProfile(nextProfile = {}) {
    const current = this.getStoredProfile();
    const merged = {
      ...current,
      ...nextProfile,
    };
    if (!merged.avatarUrl && merged.avatar_url) {
      merged.avatarUrl = merged.avatar_url;
    }
    if (!merged.avatar_url && merged.avatarUrl) {
      merged.avatar_url = merged.avatarUrl;
    }
    if (!merged.nickname || !merged.nickname.trim()) {
      merged.nickname = DEFAULT_PROFILE.nickname;
    }
    wx.setStorageSync('TEAMKEY_PROFILE', merged);
    this.globalData.profile = merged;
    return merged;
  },
});
