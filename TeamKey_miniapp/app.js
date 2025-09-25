const api = require('./utils/api');

App({
  globalData: {
    user: null,
    token: '',
    teams: [],
    activeTeamId: null,
  },

  onLaunch() {
    this.tryRestoreSession();
  },

  async tryRestoreSession() {
    const storedToken = wx.getStorageSync('TEAMKEY_TOKEN');
    if (!storedToken) {
      this.logout(false);
      return false;
    }
    api.setToken(storedToken);
    this.globalData.token = storedToken;
    try {
      const me = await api.fetchMe();
      this.globalData.user = me.user;
      this.globalData.teams = me.teams;
      wx.setStorageSync('TEAMKEY_PROFILE', {
        open_id: me.user?.open_id || me.user?.openId,
        openId: me.user?.open_id || me.user?.openId,
        nickname: me.user?.nickname,
        avatar_url: me.user?.avatarUrl || me.user?.avatar_url,
      });
      this.globalData.activeTeamId = me.teams && me.teams[0] ? me.teams[0].teamId : null;
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
    const profile = wx.getStorageSync('TEAMKEY_PROFILE') || {};
    const { token, user } = await api.login(loginResult.code, profile);
    api.setToken(token);
    wx.setStorageSync('TEAMKEY_TOKEN', token);
    wx.setStorageSync('TEAMKEY_PROFILE', {
      open_id: user.openId || user.open_id,
      openId: user.openId || user.open_id,
      nickname: user.nickname,
      avatar_url: user.avatarUrl || user.avatar_url,
    });
    this.globalData.token = token;
    this.globalData.user = user;
    const me = await api.fetchMe();
    this.globalData.user = me.user;
    this.globalData.teams = me.teams;
    this.globalData.activeTeamId = me.teams && me.teams[0] ? me.teams[0].teamId : null;
    return token;
  },

  setActiveTeam(teamId) {
    this.globalData.activeTeamId = teamId;
  },

  logout(clearStorage = true) {
    this.globalData = {
      user: null,
      token: '',
      teams: [],
      activeTeamId: null,
    };
    api.setToken('');
    if (clearStorage) {
      wx.removeStorageSync('TEAMKEY_TOKEN');
    }
  },
});
