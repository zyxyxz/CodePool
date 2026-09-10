// Read the native form value: WeChat may clear a nickname after its safety
// review without updating a value previously captured by bindinput/bindblur.
function submittedNickname(event) {
  const value = event && event.detail && event.detail.value;
  const nickname = value && typeof value.nickname === 'string' ? value.nickname.trim() : '';
  if (!nickname) throw new Error('请输入昵称；若被微信清空，请修改后重试');
  if (nickname.length > 64) throw new Error('昵称最多 64 个字符');
  return nickname;
}

function notifyNicknameReview(event) {
  const detail = event && event.detail;
  if (!detail || detail.pass === true) return;
  if (detail.timeout) {
    wx.showToast({ title: '昵称审核超时，请重新输入后保存', icon: 'none' });
  } else if (detail.pass === false) {
    wx.showToast({ title: '昵称未通过微信审核，请重新填写', icon: 'none' });
  }
}

module.exports = { submittedNickname, notifyNicknameReview };
