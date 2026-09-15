function clipboardError(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (/api scope is not declared|privacy api banned/i.test(message) || Number(error && error.errno) === 112) {
    const failure = new Error('剪贴板功能暂不可用，请联系管理员检查微信隐私声明');
    failure.code = 'CLIPBOARD_PRIVACY_UNAVAILABLE';
    return failure;
  }
  if (/auth deny|authorize|privacy|cancel/i.test(message)) {
    return new Error('需要同意微信隐私授权后使用剪贴板');
  }
  return new Error('剪贴板操作失败，请重试；也可长按口令手动复制');
}

async function authorizeClipboard() {
  const app = getApp();
  if (app && typeof app.requestPrivacyAuthorization === 'function') await app.requestPrivacyAuthorization();
}

async function copyText(value, options = {}) {
  const data = typeof value === 'string' ? value : '';
  if (!data) throw new Error('暂无可复制的内容');
  const app = getApp();
  const epoch = app && app._lockEpoch;
  const isCurrent = () => !(app && app.isVaultLocked && (app.isVaultLocked() || epoch !== app._lockEpoch)) && (typeof options.isCurrent !== 'function' || options.isCurrent());
  if (!isCurrent()) return false;
  await authorizeClipboard();
  // Privacy approval can outlive a workspace switch or the page itself.
  if (!isCurrent()) return false;
  await new Promise((resolve, reject) => {
    wx.setClipboardData({ data, success: resolve, fail: (error) => reject(clipboardError(error)) });
  });
  if (isCurrent()) wx.showToast({ title: options.successMessage || '已复制', icon: 'success' });
  return true;
}

async function readClipboard() {
  await authorizeClipboard();
  return new Promise((resolve, reject) => {
    wx.getClipboardData({
      success: (result) => resolve(typeof result.data === 'string' ? result.data : ''),
      fail: (error) => reject(clipboardError(error)),
    });
  });
}

module.exports = { copyText, readClipboard };
