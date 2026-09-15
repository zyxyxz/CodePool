// A local, per-account preference. Never an authentication or unlock credential.
const key = (userId) => `CODEPOOL_BIOMETRIC_${userId}`;
const call = (name, options = {}) => new Promise((resolve, reject) => {
  if (typeof wx[name] !== 'function') return reject(new Error('当前微信或设备不支持生物识别'));
  wx[name]({ ...options, success: resolve, fail: reject });
});
function enabled(userId) {
  try { return Boolean(userId) && wx.getStorageSync(key(userId)) === true; } catch { return false; }
}
function setEnabled(userId, value) {
  if (!userId) throw new Error('请先登录');
  wx.setStorageSync(key(userId), Boolean(value));
}
async function capability() {
  let supported;
  try { supported = await call('checkIsSupportSoterAuthentication'); }
  catch { return { mode: '', label: '生物识别', hint: '暂时无法检测，请检查微信版本或稍后重试' }; }
  const modes = ['facial', 'fingerPrint'].filter((mode) => (supported.supportMode || []).includes(mode));
  let failed = false;
  for (const mode of modes) {
    try {
      const result = await call('checkIsSoterEnrolledInDevice', { checkAuthMode: mode });
      if (result.isEnrolled) return { mode, label: mode === 'facial' ? '人脸识别' : '指纹识别', hint: '仅在本机生效，PIN 始终可作为备用方式' };
    } catch { failed = true; }
  }
  return { mode: '', label: '生物识别', hint: failed ? '检测未完成，请稍后重试；仍可使用 PIN' : modes.length ? '请先在手机系统设置中录入人脸或指纹' : '当前设备或微信不支持，请使用 PIN' };
}
async function authenticate(api, mode) {
  const { challenge } = await api.unlock({ action: 'challenge' });
  const result = await call('startSoterAuthentication', { requestAuthModes: [mode], challenge, authContent: '解锁 CodePool 密钥钱包' });
  return api.unlock({ action: 'biometric', resultJSON: result.resultJSON, signature: result.resultJSONSignature });
}
module.exports = { enabled, setEnabled, capability, authenticate };
