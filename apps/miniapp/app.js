const api = require('./utils/api');

const STORAGE = {
  TOKEN: 'CODEPOOL_TOKEN',
  PROFILE: 'CODEPOOL_PROFILE',
  ACTIVE_TEAM: 'CODEPOOL_ACTIVE_TEAM',
  PRIVACY_MASK: 'CODEPOOL_PRIVACY_MASK',
  LEGAL_CONSENT: 'CODEPOOL_LEGAL_CONSENT',
  PUBLIC_CONFIG: 'CODEPOOL_PUBLIC_CONFIG',
};

const PUBLIC_CONFIG_TTL = 2 * 60 * 1000;
const DEFAULT_PUBLIC_CONFIG = {
  workspaceName: 'CodePool',
  operatorName: '',
  supportEmail: '',
  announcement: '',
  maintenanceMode: false,
  allowNewTeams: true,
  allowPublicShares: true,
  allowInvites: true,
  defaultShareTtlMinutes: 5,
  maxShareTtlMinutes: 1440,
  defaultInviteTtlHours: 24,
  maxShareViews: 20,
};

const DEFAULT_PROFILE = {
  nickname: 'CodePool 用户',
  avatarUrl: '/assets/avatar-default.png',
  avatar_url: '/assets/avatar-default.png',
  pendingAvatar: false,
};

const MAX_AVATAR_BYTES = 512 * 1024;

function isLocalAvatar(url) {
  return typeof url === 'string'
    && Boolean(url.trim())
    && !/^https:\/\//i.test(url)
    && url.indexOf('/assets/') !== 0;
}

function compressAvatar(filePath) {
  if (typeof wx.compressImage !== 'function') return Promise.resolve(filePath);
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: 68,
      compressedWidth: 512,
      compressedHeight: 512,
      success: ({ tempFilePath }) => resolve(tempFilePath || filePath),
      fail: () => resolve(filePath),
    });
  });
}

function readAvatar(filePath) {
  return new Promise((resolve, reject) => {
    const fileSystem = wx.getFileSystemManager();
    const readFile = () => fileSystem.readFile({
      filePath,
      encoding: 'base64',
      success: ({ data }) => {
        const base64 = typeof data === 'string' ? data : '';
        const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
        const byteLength = Math.floor((base64.length * 3) / 4) - padding;
        if (!base64 || byteLength <= 0) {
          reject(new Error('头像文件读取失败'));
          return;
        }
        if (byteLength > MAX_AVATAR_BYTES) {
          const error = new Error('头像压缩后仍超过 512KB，请选择更小的图片');
          error.code = 'AVATAR_TOO_LARGE';
          reject(error);
          return;
        }
        let mimeType = '';
        if (base64.indexOf('/9j/') === 0) mimeType = 'image/jpeg';
        else if (base64.indexOf('iVBORw0KGgo') === 0) mimeType = 'image/png';
        else if (base64.indexOf('UklGR') === 0) mimeType = 'image/webp';
        if (!mimeType) {
          const error = new Error('仅支持 JPEG、PNG 或 WebP 头像');
          error.code = 'AVATAR_FORMAT_UNSUPPORTED';
          reject(error);
          return;
        }
        resolve({ data: base64, mimeType });
      },
      fail: () => reject(new Error('头像文件读取失败，请重新选择')),
    });
    if (typeof fileSystem.getFileInfo !== 'function') {
      readFile();
      return;
    }
    fileSystem.getFileInfo({
      filePath,
      success: ({ size }) => {
        if (Number(size) > MAX_AVATAR_BYTES) {
          const error = new Error('头像压缩后仍超过 512KB，请选择更小的图片');
          error.code = 'AVATAR_TOO_LARGE';
          reject(error);
          return;
        }
        readFile();
      },
      fail: () => reject(new Error('头像文件读取失败，请重新选择')),
    });
  });
}

function normalizeInviteToken(options) {
  const query = options && options.query ? options.query : (options || {});
  let token = query.inviteToken || query.invite_token;
  if (!token && query.scene) {
    try {
      const scene = decodeURIComponent(query.scene);
      const match = /(?:^|&)inviteToken=([^&]+)/.exec(scene);
      token = match ? decodeURIComponent(match[1]) : '';
    } catch (error) {
      token = '';
    }
  }
  return typeof token === 'string' ? token.trim() : '';
}

function normalizeConfigInteger(source, camelKey, snakeKey, fallback, min, max) {
  const raw = source[camelKey] !== undefined ? source[camelKey] : source[snakeKey];
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

App({
  globalData: {
    user: null,
    token: '',
    teams: [],
    activeTeamId: null,
    pendingInviteToken: '',
    profile: { ...DEFAULT_PROFILE },
    sessionReady: false,
    networkConnected: true,
    networkType: 'unknown',
    privacyMask: true,
    legalConsent: false,
    publicConfig: { ...DEFAULT_PUBLIC_CONFIG },
  },

  onLaunch(options) {
    api.onUnauthorized(() => this.clearSession(true));
    this.captureInvite(options);
    this.globalData.profile = this.getStoredProfile();
    this.globalData.activeTeamId = wx.getStorageSync(STORAGE.ACTIVE_TEAM) || null;
    const storedMask = wx.getStorageSync(STORAGE.PRIVACY_MASK);
    this.globalData.privacyMask = storedMask === '' ? true : Boolean(storedMask);
    this.globalData.legalConsent = this.hasLegalConsent();
    this.globalData.publicConfig = this.getCachedPublicConfig();
    this.observeNetwork();
    this._restorePromise = this.tryRestoreSession();
    this.refreshPublicConfig();
  },

  onShow(options) {
    this.captureInvite(options);
    if (this.globalData.token && this.globalData.pendingInviteToken) {
      this.consumePendingInvite();
    }
    this.refreshPublicConfig();
  },

  captureInvite(options) {
    const token = normalizeInviteToken(options);
    if (token) this.globalData.pendingInviteToken = token;
  },

  observeNetwork() {
    wx.getNetworkType({
      success: ({ networkType }) => {
        this.globalData.networkType = networkType;
        this.globalData.networkConnected = networkType !== 'none';
      },
    });
    wx.onNetworkStatusChange(({ isConnected, networkType }) => {
      this.globalData.networkConnected = isConnected;
      this.globalData.networkType = networkType;
    });
  },

  async awaitReady() {
    if (this._restorePromise) await this._restorePromise;
    return Boolean(this.globalData.token);
  },

  async tryRestoreSession() {
    if (this._restoring) return this._restoring;
    this._restoring = (async () => {
      const storedToken = wx.getStorageSync(STORAGE.TOKEN);
      if (!storedToken) {
        this.clearSession(false);
        this.globalData.sessionReady = true;
        return false;
      }
      if (!this.hasLegalConsent()) {
        this.clearSession(true);
        this.globalData.sessionReady = true;
        return false;
      }
      api.setToken(storedToken);
      this.globalData.token = storedToken;
      try {
        await this.refreshMe();
        this.globalData.sessionReady = true;
        await this.consumePendingInvite();
        return true;
      } catch (error) {
        if (error && error.code === 'UNAUTHORIZED') this.clearSession(true);
        this.globalData.sessionReady = true;
        return false;
      } finally {
        this._restoring = null;
      }
    })();
    return this._restoring;
  },

  async refreshMe(options = {}) {
    const me = await api.fetchMe();
    const teams = Array.isArray(me.teams) ? me.teams : [];
    this.globalData.user = me.user || null;
    this.globalData.teams = teams;
    const activeExists = teams.some((team) => team.teamId === this.globalData.activeTeamId);
    this.setActiveTeam(activeExists ? this.globalData.activeTeamId : (teams[0] ? teams[0].teamId : null));
    if (me.user) {
      const currentProfile = this.getStoredProfile();
      const localAvatar = currentProfile.avatarUrl || currentProfile.avatar_url;
      const preservePendingAvatar = Boolean(
        options.preserveLocalAvatar && currentProfile.pendingAvatar && isLocalAvatar(localAvatar),
      );
      const avatarUrl = preservePendingAvatar
        ? localAvatar
        : (me.user.avatarUrl || DEFAULT_PROFILE.avatarUrl);
      this.setStoredProfile({
        openId: me.user.openId,
        open_id: me.user.openId,
        nickname: me.user.nickname,
        avatarUrl,
        avatar_url: avatarUrl,
        pendingAvatar: preservePendingAvatar,
      });
    }
    return me;
  },

  async ensureLogin(force = false) {
    if (this.globalData.token && !force) return this.globalData.token;
    if (!this.hasLegalConsent()) {
      const error = new Error('请先阅读并同意隐私政策和用户协议');
      error.code = 'LEGAL_CONSENT_REQUIRED';
      throw error;
    }
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      await this.requestPrivacyAuthorization();
      const loginResult = await wx.login();
      if (!loginResult.code) throw new Error(loginResult.errMsg || '微信登录失败');
      const profile = this.getStoredProfile();
      const result = await api.login(loginResult.code, profile);
      if (!result.token) throw new Error('服务端未返回登录凭证');
      api.setToken(result.token);
      this.globalData.token = result.token;
      this.globalData.user = result.user || null;
      await this.refreshMe({ preserveLocalAvatar: true });
      try {
        await this.syncStoredProfile({ updateNickname: false });
      } catch (error) {
        wx.showToast({ title: error.message || '已登录，个人资料同步失败', icon: 'none' });
      }
      await this.consumePendingInvite();
      return result.token;
    })();
    try {
      return await this._loginPromise;
    } finally {
      this._loginPromise = null;
    }
  },

  async syncStoredProfile(options = {}) {
    if (!this.globalData.token) {
      const error = new Error('请先登录后再保存资料');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    if (this._profileSyncPromise) return this._profileSyncPromise;
    const profile = this.getStoredProfile();
    const nickname = (profile.nickname || '').trim();
    const avatarUrl = profile.avatarUrl || profile.avatar_url || '';
    const hasPendingAvatar = Boolean(profile.pendingAvatar && isLocalAvatar(avatarUrl));
    this._profileSyncPromise = (async () => {
      try {
        const update = {};
        if (options.updateNickname !== false) update.nickname = nickname;
        if (hasPendingAvatar) {
          const compressedPath = await compressAvatar(avatarUrl);
          update.avatar = await readAvatar(compressedPath);
        }
        if (Object.keys(update).length) await api.updateProfile(update);
        return await this.refreshMe();
      } catch (error) {
        await this.refreshMe().catch(() => undefined);
        this.setStoredProfile({
          nickname: profile.nickname,
          ...(hasPendingAvatar ? { avatarUrl, avatar_url: avatarUrl, pendingAvatar: true } : {}),
        });
        throw error;
      } finally {
        this._profileSyncPromise = null;
      }
    })();
    return this._profileSyncPromise;
  },

  setActiveTeam(teamId) {
    this.globalData.activeTeamId = teamId || null;
    if (teamId) wx.setStorageSync(STORAGE.ACTIVE_TEAM, teamId);
    else wx.removeStorageSync(STORAGE.ACTIVE_TEAM);
  },

  setPrivacyMask(enabled) {
    const value = Boolean(enabled);
    this.globalData.privacyMask = value;
    wx.setStorageSync(STORAGE.PRIVACY_MASK, value);
  },

  hasLegalConsent() {
    const consent = wx.getStorageSync(STORAGE.LEGAL_CONSENT);
    return Boolean(consent && consent.version === '2026-08-17' && consent.acceptedAt);
  },

  setLegalConsent(accepted) {
    if (accepted) {
      wx.setStorageSync(STORAGE.LEGAL_CONSENT, {
        version: '2026-08-17',
        acceptedAt: new Date().toISOString(),
      });
    } else {
      wx.removeStorageSync(STORAGE.LEGAL_CONSENT);
    }
    this.globalData.legalConsent = Boolean(accepted);
  },

  requestPrivacyAuthorization() {
    if (typeof wx.getPrivacySetting !== 'function' || typeof wx.requirePrivacyAuthorize !== 'function') {
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      wx.getPrivacySetting({
        success: ({ needAuthorization }) => {
          if (!needAuthorization) {
            resolve(true);
            return;
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: () => reject(new Error('需要同意微信隐私保护指引后才能登录')),
          });
        },
        fail: () => resolve(true),
      });
    });
  },

  normalizePublicConfig(payload) {
    const source = payload && payload.config && typeof payload.config === 'object'
      ? payload.config
      : (payload || {});
    const rawWorkspaceName = source.workspaceName || source.workspace_name;
    const workspaceName = typeof rawWorkspaceName === 'string' && rawWorkspaceName.trim()
      ? rawWorkspaceName.trim().slice(0, 40)
      : DEFAULT_PUBLIC_CONFIG.workspaceName;
    const announcement = typeof source.announcement === 'string'
      ? source.announcement.trim().slice(0, 500)
      : '';
    const supportEmail = typeof source.supportEmail === 'string'
      ? source.supportEmail.trim().slice(0, 254)
      : (typeof source.support_email === 'string' ? source.support_email.trim().slice(0, 254) : '');
    const operatorName = typeof source.operatorName === 'string'
      ? source.operatorName.trim().slice(0, 120)
      : (typeof source.operator_name === 'string' ? source.operator_name.trim().slice(0, 120) : '');
    const maxShareTtlMinutes = normalizeConfigInteger(
      source,
      'maxShareTtlMinutes',
      'max_share_ttl_minutes',
      DEFAULT_PUBLIC_CONFIG.maxShareTtlMinutes,
      1,
      10080,
    );
    const defaultShareTtlMinutes = Math.min(maxShareTtlMinutes, normalizeConfigInteger(
      source,
      'defaultShareTtlMinutes',
      'default_share_ttl_minutes',
      DEFAULT_PUBLIC_CONFIG.defaultShareTtlMinutes,
      1,
      1440,
    ));
    return {
      workspaceName,
      operatorName,
      supportEmail,
      announcement,
      maintenanceMode: source.maintenanceMode === true || source.maintenance_mode === true,
      allowNewTeams: source.allowNewTeams !== false && source.allow_new_teams !== false,
      allowPublicShares: source.allowPublicShares !== false && source.allow_public_shares !== false,
      allowInvites: source.allowInvites !== false && source.allow_invites !== false,
      defaultShareTtlMinutes,
      maxShareTtlMinutes,
      defaultInviteTtlHours: normalizeConfigInteger(
        source,
        'defaultInviteTtlHours',
        'default_invite_ttl_hours',
        DEFAULT_PUBLIC_CONFIG.defaultInviteTtlHours,
        1,
        720,
      ),
      maxShareViews: normalizeConfigInteger(
        source,
        'maxShareViews',
        'max_share_views',
        DEFAULT_PUBLIC_CONFIG.maxShareViews,
        1,
        10000,
      ),
    };
  },

  getCachedPublicConfig() {
    const cached = wx.getStorageSync(STORAGE.PUBLIC_CONFIG);
    if (!cached || typeof cached !== 'object' || !cached.value) {
      return { ...DEFAULT_PUBLIC_CONFIG };
    }
    return this.normalizePublicConfig(cached.value);
  },

  async refreshPublicConfig(force = false) {
    const cached = wx.getStorageSync(STORAGE.PUBLIC_CONFIG);
    const cacheFresh = cached && cached.fetchedAt && Date.now() - Number(cached.fetchedAt) < PUBLIC_CONFIG_TTL;
    if (!force && cacheFresh) {
      this.globalData.publicConfig = this.normalizePublicConfig(cached.value);
      return this.globalData.publicConfig;
    }
    if (this._publicConfigPromise) return this._publicConfigPromise;
    this._publicConfigPromise = api.fetchConfig()
      .then((payload) => {
        const value = this.normalizePublicConfig(payload);
        this.globalData.publicConfig = value;
        wx.setStorageSync(STORAGE.PUBLIC_CONFIG, { value, fetchedAt: Date.now() });
        return value;
      })
      .catch(() => this.globalData.publicConfig || { ...DEFAULT_PUBLIC_CONFIG })
      .finally(() => {
        this._publicConfigPromise = null;
      });
    return this._publicConfigPromise;
  },

  async guardMaintenance(action = '此操作') {
    const config = await this.refreshPublicConfig(true);
    if (!config.maintenanceMode) return true;
    wx.showModal({
      title: `${config.workspaceName} 正在维护`,
      content: config.announcement || `${action}暂不可用，请稍后再试。已有内容仍会按照当前权限安全展示。`,
      showCancel: false,
      confirmText: '我知道了',
    });
    return false;
  },

  async consumePendingInvite() {
    const token = this.globalData.pendingInviteToken;
    if (!token || !this.globalData.token || this._consumingInvite) return null;
    this._consumingInvite = true;
    try {
      const config = await this.refreshPublicConfig(true);
      if (config.maintenanceMode) {
        wx.showToast({ title: '系统维护中，邀请稍后自动重试', icon: 'none' });
        return null;
      }
      const summary = await api.acceptInvite(token);
      await this.refreshMe();
      if (summary && summary.teamId) this.setActiveTeam(summary.teamId);
      this.globalData.pendingInviteToken = '';
      wx.showToast({ title: '已加入团队', icon: 'success' });
      return summary;
    } catch (error) {
      const retryable = Boolean(error && (error.retryable || error.offline || error.code === 'MAINTENANCE_MODE'));
      if (!retryable) this.globalData.pendingInviteToken = '';
      wx.showToast({ title: retryable ? '邀请领取暂未完成，将稍后重试' : (error.message || '邀请已失效'), icon: 'none' });
      return null;
    } finally {
      this._consumingInvite = false;
    }
  },

  clearSession(clearStorage = true) {
    this.globalData.user = null;
    this.globalData.token = '';
    this.globalData.teams = [];
    this.globalData.activeTeamId = null;
    api.setToken('');
    if (clearStorage) {
      wx.removeStorageSync(STORAGE.TOKEN);
      wx.removeStorageSync(STORAGE.ACTIVE_TEAM);
    }
  },

  logout(clearStorage = true) {
    this.clearSession(clearStorage);
  },

  getStoredProfile() {
    const stored = wx.getStorageSync(STORAGE.PROFILE) || {};
    const nickname = typeof stored.nickname === 'string' && stored.nickname.trim()
      ? stored.nickname.trim()
      : DEFAULT_PROFILE.nickname;
    const avatar = stored.avatarUrl || stored.avatar_url || DEFAULT_PROFILE.avatarUrl;
    const profile = {
      ...DEFAULT_PROFILE,
      ...stored,
      nickname,
      avatarUrl: avatar,
      avatar_url: avatar,
      pendingAvatar: stored.pendingAvatar === true || isLocalAvatar(avatar),
    };
    wx.setStorageSync(STORAGE.PROFILE, profile);
    return profile;
  },

  setStoredProfile(nextProfile = {}) {
    const current = this.getStoredProfile();
    const merged = { ...current, ...nextProfile };
    merged.nickname = typeof merged.nickname === 'string' && merged.nickname.trim()
      ? merged.nickname.trim().slice(0, 64)
      : DEFAULT_PROFILE.nickname;
    const avatar = merged.avatarUrl || merged.avatar_url || DEFAULT_PROFILE.avatarUrl;
    merged.avatarUrl = avatar;
    merged.avatar_url = avatar;
    wx.setStorageSync(STORAGE.PROFILE, merged);
    this.globalData.profile = merged;
    return merged;
  },
});
