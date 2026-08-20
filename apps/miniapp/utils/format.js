const KIND_LABELS = {
  totp: '动态验证码',
  snippet: '代码片段',
  code: '一次性代码',
  secret: '敏感密文',
  note: '团队备注',
};

const ROLE_LABELS = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  guest: '访客',
};

const ACTION_LABELS = {
  AUTH_LOGIN: '登录 CodePool',
  PROFILE_UPDATE: '更新个人资料',
  PROFILE_AVATAR_UPDATE: '更新个人头像',
  ACCOUNT_DELETION_REQUEST: '提交账号注销申请',
  ACCOUNT_DELETION_WITHDRAW: '撤回账号注销申请',
  TEAM_CREATE: '创建团队',
  INVITE_CREATE: '创建成员邀请',
  INVITE_ACCEPT: '接受团队邀请',
  MEMBER_ROLE_UPDATE: '调整成员权限',
  MEMBER_REMOVE: '移除团队成员',
  ITEM_CREATE: '新增共享内容',
  ITEM_REVEAL: '查看敏感内容',
  ITEM_UPDATE: '编辑共享内容',
  ITEM_DELETE: '删除共享内容',
  TOTP_CREATE: '新增动态验证码',
  TOTP_VIEW: '查看动态验证码',
  TOTP_UPDATE: '编辑动态验证码',
  TOTP_DELETE: '删除动态验证码',
  SHARE_CREATE: '创建临时分享',
  SHARE_REDEEM: '领取临时分享',
  SHARE_REVOKE: '撤销临时分享',
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  if (!value) return null;
  const normalized = typeof value === 'string' && value.indexOf('T') === -1
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeYear = false) {
  const date = parseDate(value);
  if (!date) return value || '--';
  const datePart = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${includeYear ? `${date.getFullYear()}-` : ''}${datePart} ${timePart}`;
}

function formatRelative(value) {
  const date = parseDate(value);
  if (!date) return value || '--';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDate(value);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDate(value, true);
}

function isExpired(value) {
  const date = parseDate(value);
  return Boolean(date && date.getTime() <= Date.now());
}

function maskText(value, visibleStart = 2, visibleEnd = 2) {
  const text = String(value || '');
  if (!text) return '--';
  if (text.length <= visibleStart + visibleEnd) return '••••••';
  return `${text.slice(0, visibleStart)}${'•'.repeat(Math.min(8, text.length - visibleStart - visibleEnd))}${text.slice(-visibleEnd)}`;
}

function friendlyError(error, fallback = '操作失败，请稍后重试') {
  if (!error) return fallback;
  if (error.code === 'UNAUTHORIZED') return '登录已过期，请重新登录';
  if (error.code === 'ACCOUNT_DISABLED' || error.code === 'USER_DISABLED') return '账号已被停用，请联系团队管理员';
  if (error.code === 'WECHAT_CODE_INVALID') return '微信登录凭证已失效，请重新点击登录';
  if (error.code === 'WECHAT_CONFIGURATION_ERROR') return '微信登录配置异常，请联系管理员';
  if (error.code === 'WECHAT_UPSTREAM_UNAVAILABLE') return '微信登录服务繁忙，请稍后重试';
  if (error.statusCode === 429 || error.code === 'RATE_LIMITED') return '操作过于频繁，请稍后再试';
  if (error.code === 'MAINTENANCE_MODE') return '系统正在维护，请稍后再试';
  if (error.offline || error.code === 'NETWORK_ERROR') return '网络不可用，请检查连接';
  if (error.code === 'TIMEOUT') return '请求超时，请稍后重试';
  return error.message || fallback;
}

module.exports = {
  ACTION_LABELS,
  KIND_LABELS,
  ROLE_LABELS,
  formatDate,
  formatRelative,
  friendlyError,
  isExpired,
  maskText,
  parseDate,
};
