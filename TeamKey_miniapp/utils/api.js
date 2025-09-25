const { BASE_URL } = require('../config');

const API_PREFIX = '/api/v1';
let authToken = wx.getStorageSync('TEAMKEY_TOKEN') || '';

const buildHeader = (headers = {}) => {
  const next = { 'Content-Type': 'application/json', ...headers };
  if (authToken) {
    next.Authorization = `Bearer ${authToken}`;
  }
  return next;
};

const request = (options) => {
  const { url, method = 'GET', data, header } = options;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${API_PREFIX}${url}`,
      method,
      data,
      header: buildHeader(header),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
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
    wx.setStorageSync('TEAMKEY_TOKEN', token);
  } else {
    wx.removeStorageSync('TEAMKEY_TOKEN');
  }
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
        avatar_url: profile?.avatar_url || profile?.avatarUrl,
        open_id: profile?.open_id || profile?.openId,
        openId: profile?.open_id || profile?.openId,
      },
    }).then((res) => ({ token: res.access_token || res.token, user: res.user })),
  fetchMe: () => request({ url: '/auth/me' }).then((res) => res),
  fetchAccounts: (teamId, query) =>
    request({
      url: `/accounts`,
      data: { team_id: teamId, q: query },
    }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  fetchAccountDetail: (accountId) => request({ url: `/accounts/${accountId}` }),
  fetchAccountCode: (accountId) => request({ url: `/accounts/${accountId}/code` }),
  createAccount: (payload) => request({ url: '/accounts', method: 'POST', data: payload }),
  deleteAccount: (accountId) => request({ url: `/accounts/${accountId}`, method: 'DELETE' }),
  fetchTeams: () => request({ url: '/teams' }).then((res) => (Array.isArray(res) ? res : res || [])),
  createTeam: (payload) => request({ url: '/teams', method: 'POST', data: payload }),
  fetchTeamMembers: (teamId) => request({ url: `/teams/${teamId}/members` }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  inviteMember: (teamId, payload) => request({ url: `/teams/${teamId}/invite`, method: 'POST', data: payload }),
  removeMember: (teamId, userId) => request({ url: `/teams/${teamId}/members/${userId}`, method: 'DELETE' }),
  updateMemberRole: (teamId, userId, payload) =>
    request({ url: `/teams/${teamId}/members/${userId}`, method: 'PATCH', data: payload }),
  fetchLogs: (teamId) =>
    request({
      url: '/audit/logs',
      data: teamId ? { team_id: teamId } : {},
    }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  createShare: (payload) => request({ url: '/shares', method: 'POST', data: payload }),
  fetchShares: (accountId) =>
    request({ url: '/shares', data: { account_id: accountId } }).then((res) => (Array.isArray(res) ? res : res.items || [])),
  redeemShare: (token) => request({ url: `/shares/public/${token}` }),
};

module.exports = api;
