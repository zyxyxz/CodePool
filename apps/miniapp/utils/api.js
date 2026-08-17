const { BASE_URL } = require('../config');

const API_PREFIX = '/api/v1';
let authToken = wx.getStorageSync('CODEPOOL_TOKEN') || '';

const normalizeTeams = (teams = []) => {
  if (!Array.isArray(teams)) return [];
  return teams.map((team) => {
    if (!team || typeof team !== 'object') return team;
    const teamId = team.teamId ?? team.team_id ?? team.id;
    const ownerId = team.ownerId ?? team.owner_id;
    const createdAt = team.createdAt ?? team.created_at;
    return {
      ...team,
      teamId,
      team_id: team.team_id ?? teamId,
      ownerId,
      owner_id: team.owner_id ?? ownerId,
      createdAt,
      created_at: team.created_at ?? createdAt,
    };
  });
};

const normalizeAccount = (account) => {
  if (!account || typeof account !== 'object') return account;
  const accountIdentifierRaw =
    account.accountIdentifier ??
    account.account_identifier ??
    account.account ??
    null;
  const accountIdentifier =
    typeof accountIdentifierRaw === 'string'
      ? accountIdentifierRaw.trim() || null
      : accountIdentifierRaw;
  const remarkCandidate =
    account.remark ??
    account.note ??
    (account.extra_metadata ? account.extra_metadata.remark : undefined);
  const remark =
    remarkCandidate === undefined
      ? null
      : typeof remarkCandidate === 'string'
      ? remarkCandidate.trim() || null
      : remarkCandidate;
  const periodValue = Number(account.period ?? account.period_seconds);
  const period = Number.isFinite(periodValue) && periodValue > 0 ? periodValue : 30;
  const digitsValue = Number(account.digits);
  const digits = Number.isFinite(digitsValue) && digitsValue > 0 ? digitsValue : 6;
  const teamId = account.teamId ?? account.team_id ?? null;
  const createdAt = account.createdAt ?? account.created_at ?? null;
  const updatedAt = account.updatedAt ?? account.updated_at ?? null;

  return {
    ...account,
    teamId,
    team_id: teamId,
    accountIdentifier,
    account_identifier: accountIdentifier,
    remark,
    digits,
    period,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
};

const sanitizeData = (data = {}, preserveEmptyKeys = []) => {
  const cleaned = {};
  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === 'string' && value.trim() === '') {
      if (preserveEmptyKeys.includes(key)) {
        cleaned[key] = '';
      }
      return;
    }
    cleaned[key] = value;
  });
  return cleaned;
};

const buildHeader = (headers = {}) => {
  const next = { 'Content-Type': 'application/json', ...headers };
  if (authToken) {
    next.Authorization = `Bearer ${authToken}`;
  }
  return next;
};

const request = (options) => {
  const { url, method = 'GET', data, header, preserveEmptyKeys = [] } = options;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${API_PREFIX}${url}`,
      method,
      data: sanitizeData(data, preserveEmptyKeys),
      header: buildHeader(header),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = res.data;
          // CodePool API 使用统一响应信封，小程序只向页面暴露业务数据。
          resolve(payload && payload.code === 0 && Object.prototype.hasOwnProperty.call(payload, 'data')
            ? payload.data
            : payload);
        } else if (res.statusCode === 401) {
          setToken('');
          reject(new Error('UNAUTHORIZED'));
        } else {
          reject(new Error(res.data?.msg || 'Request failed'));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
};

const setToken = (token) => {
  authToken = token;
  if (token) {
    wx.setStorageSync('CODEPOOL_TOKEN', token);
  } else {
    wx.removeStorageSync('CODEPOOL_TOKEN');
  }
};

const normalizeAvatarUrl = (url) => {
  if (!url) return undefined;
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
};

const api = {
  setToken,
  request,
  login: (wxCode, profile) =>
    request({
      url: '/auth/login',
      method: 'POST',
      data: {
        wx_code: wxCode,
        nickname: profile?.nickname,
        avatar_url: normalizeAvatarUrl(profile?.avatar_url || profile?.avatarUrl),
        open_id: profile?.open_id || profile?.openId,
        openId: profile?.open_id || profile?.openId,
      },
    }).then((res) => ({ token: res.access_token || res.token, user: res.user })),
  fetchMe: () =>
    request({ url: '/auth/me' }).then((res) =>
      res && typeof res === 'object' ? { ...res, teams: normalizeTeams(res.teams) } : res
    ),
  fetchAccounts: (teamId, query) => {
    if (!teamId) return Promise.resolve([]);
    return request({
      url: `/accounts`,
      data: { team_id: teamId, q: query },
    }).then((res) => {
      const list = Array.isArray(res) ? res : res.items || [];
      return list.map((item) => normalizeAccount(item));
    });
  },
  fetchAccountDetail: (accountId) =>
    request({ url: `/accounts/${accountId}` }).then((res) => normalizeAccount(res)),
  fetchAccountCode: (accountId) =>
    request({ url: `/accounts/${accountId}/code` }).then((res) => {
      const rawPeriod = Number(res.period ?? res.Period);
      const period = Number.isFinite(rawPeriod) && rawPeriod > 0 ? rawPeriod : 30;
      const rawExpires = res.expiresIn ?? res.expires_in ?? res.expires;
      const parsedExpires = Number(rawExpires);
      const expiresIn = Number.isFinite(parsedExpires) && parsedExpires >= 0 ? parsedExpires : period;
      return {
        code: res.code,
        period,
        expiresIn,
      };
    }),
  fetchItems: (teamId, query) => {
    if (!teamId) return Promise.resolve([]);
    return request({ url: '/items', data: { teamId, q: query } }).then((res) =>
      (Array.isArray(res) ? res : res.items || []).filter((item) => item.kind !== 'totp')
    );
  },
  fetchItem: (itemId) => request({ url: `/items/${itemId}` }),
  createItem: (payload) => request({ url: '/items', method: 'POST', data: payload }),
  deleteItem: (itemId) => request({ url: `/items/${itemId}`, method: 'DELETE' }),
  updateAccount: (accountId, payload, options = {}) =>
    request({
      url: `/accounts/${accountId}`,
      method: 'PATCH',
      data: payload,
      preserveEmptyKeys: options.preserveEmptyKeys || [],
    }).then((res) => normalizeAccount(res)),
  createAccount: (payload) =>
    request({ url: '/accounts', method: 'POST', data: payload }).then((res) => normalizeAccount(res)),
  deleteAccount: (accountId) => request({ url: `/accounts/${accountId}`, method: 'DELETE' }),
  fetchTeams: () =>
    request({ url: '/teams' }).then((res) =>
      normalizeTeams(Array.isArray(res) ? res : res?.items || res || [])
    ),
  createTeam: (payload) =>
    request({ url: '/teams', method: 'POST', data: payload }).then((res) =>
      res && typeof res === 'object' ? { ...res, ...normalizeTeams([res])[0] } : res
    ),
  fetchTeamMembers: (teamId) => {
    if (!teamId) return Promise.resolve([]);
    return request({ url: `/teams/${teamId}/members` }).then((res) => (Array.isArray(res) ? res : res.items || []));
  },
  inviteMember: (teamId, payload) => request({ url: `/teams/${teamId}/invite`, method: 'POST', data: payload }),
  removeMember: (teamId, userId) => request({ url: `/teams/${teamId}/members/${userId}`, method: 'DELETE' }),
  updateMemberRole: (teamId, userId, payload) =>
    request({ url: `/teams/${teamId}/members/${userId}`, method: 'PATCH', data: payload }),
  createTeamInvite: (teamId, payload) =>
    request({
      url: `/teams/${teamId}/invites`,
      method: 'POST',
      data: {
        role: payload.role || 'member',
        expiresInHours: Math.max(1, Math.ceil((payload.expires_in_minutes || 1440) / 60)),
      },
    }).then((invite) => ({
      ...invite,
      expires_at: invite.expiresAt,
    })),
  fetchTeamInvites: (teamId) =>
    request({ url: `/teams/${teamId}/invites` }).then((res) => (Array.isArray(res) ? res : [])),
  acceptInvite: (token) => request({ url: `/teams/invites/${token}/accept`, method: 'POST' }).then((result) => ({
    ...result,
    team_id: result.teamId,
  })),
  fetchLogs: (teamId) =>
    request({
      url: '/audit/logs',
      data: teamId ? { team_id: teamId } : {},
    }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  createShare: (payload) => request({
    url: '/shares',
    method: 'POST',
    data: {
      itemId: payload.itemId,
      account_id: payload.account_id || payload.accountId,
      expires_in_sec: payload.expires_in_sec || (payload.expires_in_minutes || 5) * 60,
      maxViews: payload.maxViews || 1,
    },
  }),
  fetchShares: (accountId) =>
    request({ url: '/shares', data: { account_id: accountId } }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  redeemShare: (token) => request({ url: `/shares/public/${token}` }),
};

module.exports = api;
