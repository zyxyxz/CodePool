/**
 * 小程序生产配置。
 *
 * 微信公众平台 -> 开发管理 -> 开发设置中，需要将 BASE_URL 加入 request 合法域名。
 * 如需本地联调，请临时关闭开发者工具的合法域名校验，并在控制台执行：
 * wx.setStorageSync('CODEPOOL_API_BASE_URL', 'http://localhost:3000')
 * 体验版和正式版会忽略所有本地覆盖值，避免登录凭证被发送到非生产服务。
 */
const PRODUCTION_BASE_URL = 'https://codepool.apps.aisp24.com';

function getBaseUrl() {
  const override = wx.getStorageSync('CODEPOOL_API_BASE_URL');
  if (typeof override !== 'string' || !override.trim()) {
    return PRODUCTION_BASE_URL;
  }
  const value = override.trim().replace(/\/$/, '');
  const accountInfo = typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync() : null;
  const envVersion = accountInfo && accountInfo.miniProgram
    ? accountInfo.miniProgram.envVersion
    : 'release';
  if (envVersion === 'develop') {
    return value;
  }
  return PRODUCTION_BASE_URL;
}

module.exports = {
  BASE_URL: getBaseUrl(),
  PRODUCTION_BASE_URL,
  API_PREFIX: '/api/v1',
  REQUEST_TIMEOUT: 15000,
  CLIENT_VERSION: '0.3.1',
};
