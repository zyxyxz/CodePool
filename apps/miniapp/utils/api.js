const {
  BASE_URL,
  API_PREFIX,
  REQUEST_TIMEOUT,
  CLIENT_VERSION,
} = require('../config');

let authToken = wx.getStorageSync('CODEPOOL_TOKEN') || '';
let unauthorizedHandler = null;

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.statusCode = options.statusCode || 0;
    this.code = options.code || 'REQUEST_FAILED';
    this.retryable = Boolean(options.retryable);
    this.offline = Boolean(options.offline);
  }
}

function sanitizeData(data = {}, preserveEmptyKeys = [], preserveNullKeys = []) {
  const cleaned = {};
  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    if (value === undefined) return;
    if (value === null) {
      if (preserveNullKeys.includes(key)) cleaned[key] = null;
      return;
    }
    if (typeof value === 'string' && value.trim() === '') {
      if (preserveEmptyKeys.includes(key)) cleaned[key] = '';
      return;
    }
    cleaned[key] = value;
  });
  return cleaned;
}

function buildHeader(headers = {}) {
  const next = {
    'Content-Type': 'application/json',
    'X-CodePool-Client': `miniapp/${CLIENT_VERSION}`,
    ...headers,
  };
  if (authToken) next.Authorization = `Bearer ${authToken}`;
  return next;
}

function unwrapResponse(payload, statusCode) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'code')) {
    if (payload.code === 0) return payload.data;
    throw new ApiError(payload.msg || '请求失败', {
      statusCode,
      code: payload.error || String(payload.code),
      retryable: statusCode >= 500,
    });
  }
  return payload;
}

function request(options) {
  const {
    url,
    method = 'GET',
    data,
    header,
    preserveEmptyKeys = [],
    preserveNullKeys = [],
  } = options;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${API_PREFIX}${url}`,
      method,
      data: sanitizeData(data, preserveEmptyKeys, preserveNullKeys),
      header: buildHeader(header),
      timeout: REQUEST_TIMEOUT,
      success(res) {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(unwrapResponse(res.data, res.statusCode));
            return;
          }
          const payload = res.data || {};
          const responseCode = payload.error || (res.statusCode === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED');
          const disabledAccount = responseCode === 'ACCOUNT_DISABLED' || responseCode === 'USER_DISABLED';
          if (res.statusCode === 401 || disabledAccount) {
            setToken('');
            if (typeof unauthorizedHandler === 'function') unauthorizedHandler();
          }
          reject(new ApiError(payload.msg || (res.statusCode === 401 ? '登录已过期，请重新登录' : '请求失败'), {
            statusCode: res.statusCode,
            code: responseCode,
            retryable: res.statusCode >= 500 || res.statusCode === 429,
          }));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        const message = error && error.errMsg ? error.errMsg : '';
        const timeout = message.indexOf('timeout') !== -1;
        reject(new ApiError(timeout ? '请求超时，请稍后重试' : '网络不可用，请检查连接', {
          code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          retryable: true,
          offline: !timeout,
        }));
      },
    });
  });
}

function setToken(token) {
  authToken = token || '';
  if (authToken) wx.setStorageSync('CODEPOOL_TOKEN', authToken);
  else wx.removeStorageSync('CODEPOOL_TOKEN');
}

function onUnauthorized(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

function normalizeAvatarUrl(url) {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed : undefined;
}

function normalizeTeam(team) {
  if (!team || typeof team !== 'object') return team;
  const teamId = team.teamId || team.team_id || team.id;
  return {
    ...team,
    teamId,
    team_id: teamId,
    ownerId: team.ownerId || team.owner_id,
    createdAt: team.createdAt || team.created_at,
    memberCount: Number(team.memberCount || team.member_count || 0),
    itemCount: Number(team.itemCount || team.item_count || 0),
  };
}

function normalizeTeams(teams) {
  return Array.isArray(teams) ? teams.map(normalizeTeam) : [];
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object') return account;
  const identifierRaw = account.accountIdentifier || account.account_identifier || account.account || '';
  const period = Number(account.period || account.period_seconds || 30);
  const digits = Number(account.digits || 6);
  return {
    ...account,
    teamId: account.teamId || account.team_id,
    accountIdentifier: identifierRaw || '',
    account_identifier: identifierRaw || '',
    remark: account.remark || '',
    period: Number.isFinite(period) && period > 0 ? period : 30,
    digits: Number.isFinite(digits) && digits > 0 ? digits : 6,
    createdAt: account.createdAt || account.created_at,
    updatedAt: account.updatedAt || account.updated_at,
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    teamId: item.teamId || item.team_id,
    identifier: item.identifier || '',
    language: item.language || '',
    expiresAt: item.expiresAt || item.expires_at || null,
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at,
  };
}

function normalizeMember(member) {
  if (!member || typeof member !== 'object') return member;
  const userId = member.userId || member.user_id || member.id;
  return {
    ...member,
    id: userId,
    userId,
    avatarUrl: member.avatarUrl || member.avatar_url || '',
    joinedAt: member.joinedAt || member.joined_at,
    expiresAt: member.expiresAt || member.expires_at,
  };
}

function listFromResponse(response) {
  if (Array.isArray(response)) return response;
  return response && Array.isArray(response.items) ? response.items : [];
}

const api = {
  ApiError,
  setToken,
  onUnauthorized,
  request,
  getBaseUrl: () => BASE_URL,
  fetchConfig: () => request({ url: '/config' }),
  login: (wxCode, profile = {}) => request({
    url: '/auth/login',
    method: 'POST',
    data: {
      wx_code: wxCode,
      nickname: profile.nickname,
      avatar_url: normalizeAvatarUrl(profile.avatar_url || profile.avatarUrl),
      open_id: profile.open_id || profile.openId,
    },
  }).then((res) => ({
    token: res.accessToken || res.access_token || res.token,
    user: res.user,
  })),
  fetchMe: () => request({ url: '/auth/me' }).then((res) => ({
    ...res,
    teams: normalizeTeams(res && res.teams),
  })),
  fetchDeletionRequest: () => request({ url: '/auth/deletion-request' }),
  createDeletionRequest: (note) => request({
    url: '/auth/deletion-request',
    method: 'POST',
    data: note ? { note } : {},
  }),
  withdrawDeletionRequest: () => request({
    url: '/auth/deletion-request',
    method: 'DELETE',
  }),
  fetchTeams: () => request({ url: '/teams' }).then((res) => normalizeTeams(listFromResponse(res))),
  createTeam: (payload) => request({ url: '/teams', method: 'POST', data: payload }).then(normalizeTeam),
  fetchTeamMembers: (teamId) => request({ url: `/teams/${teamId}/members` })
    .then((res) => listFromResponse(res).map(normalizeMember)),
  updateMemberRole: (teamId, userId, payload) => request({
    url: `/teams/${teamId}/members/${userId}`,
    method: 'PATCH',
    data: payload,
  }),
  removeMember: (teamId, userId) => request({
    url: `/teams/${teamId}/members/${userId}`,
    method: 'DELETE',
  }),
  createTeamInvite: (teamId, payload = {}) => request({
    url: `/teams/${teamId}/invites`,
    method: 'POST',
    data: {
      role: payload.role || 'member',
      expiresInHours: payload.expiresInHours || 24,
    },
  }),
  fetchTeamInvites: (teamId) => request({ url: `/teams/${teamId}/invites` })
    .then(listFromResponse),
  acceptInvite: (token) => request({
    url: `/teams/invites/${encodeURIComponent(token)}/accept`,
    method: 'POST',
  }),
  fetchAccounts: (teamId, query) => {
    if (!teamId) return Promise.resolve([]);
    return request({ url: '/accounts', data: { team_id: teamId, q: query } })
      .then((res) => listFromResponse(res).map(normalizeAccount));
  },
  fetchAccountDetail: (accountId) => request({ url: `/accounts/${accountId}` }).then(normalizeAccount),
  fetchAccountCode: (accountId) => request({ url: `/accounts/${accountId}/code` }).then((res) => {
    const period = Number(res.period || 30);
    const expiresIn = Number(res.expiresIn !== undefined ? res.expiresIn : res.expires_in);
    return {
      code: res.code,
      period: Number.isFinite(period) && period > 0 ? period : 30,
      expiresIn: Number.isFinite(expiresIn) && expiresIn >= 0 ? expiresIn : period,
    };
  }),
  createAccount: (payload) => request({ url: '/accounts', method: 'POST', data: payload }).then(normalizeAccount),
  updateAccount: (accountId, payload, options = {}) => request({
    url: `/accounts/${accountId}`,
    method: 'PATCH',
    data: payload,
    preserveEmptyKeys: options.preserveEmptyKeys || [],
  }).then(normalizeAccount),
  deleteAccount: (accountId) => request({ url: `/accounts/${accountId}`, method: 'DELETE' }),
  fetchItems: (teamId, query, kind) => {
    if (!teamId) return Promise.resolve([]);
    return request({ url: '/items', data: { teamId, q: query, kind } })
      .then((res) => listFromResponse(res).filter((item) => item.kind !== 'totp').map(normalizeItem));
  },
  fetchItem: (itemId) => request({ url: `/items/${itemId}` }).then(normalizeItem),
  createItem: (payload) => request({ url: '/items', method: 'POST', data: payload }).then(normalizeItem),
  updateItem: (itemId, payload, options = {}) => request({
    url: `/items/${itemId}`,
    method: 'PATCH',
    data: payload,
    preserveEmptyKeys: options.preserveEmptyKeys || [],
    preserveNullKeys: options.preserveNullKeys || [],
  }).then(normalizeItem),
  deleteItem: (itemId) => request({ url: `/items/${itemId}`, method: 'DELETE' }),
  fetchLogs: (teamId, limit = 100) => request({
    url: '/audit/logs',
    data: teamId ? { team_id: teamId, limit } : {},
  }).then(listFromResponse),
  createShare: (payload) => request({
    url: '/shares',
    method: 'POST',
    data: {
      itemId: payload.itemId || payload.accountId || payload.account_id,
      expiresInSec: payload.expiresInSec || payload.expires_in_sec || 300,
      maxViews: payload.maxViews || 1,
    },
  }),
  fetchShares: (itemId) => request({ url: '/shares', data: { itemId } }).then(listFromResponse),
  revokeShare: (shareId) => request({
    url: `/shares/${shareId}`,
    method: 'DELETE',
  }),
  previewShare: (token) => request({
    url: `/shares/public/${encodeURIComponent(token)}`,
  }).then(normalizeItem),
  redeemShare: (token) => request({
    url: `/shares/public/${encodeURIComponent(token)}`,
    method: 'POST',
  }).then(normalizeItem),
};

module.exports = api;
