import { env } from './env';
import { ApiError } from './api';

let cached: { token: string; expires: number } | undefined;
async function accessToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ grant_type: 'client_credential', appid: env.wechatAppId, secret: env.wechatAppSecret }),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== 'string') throw new Error('Soter unavailable');
  cached = { token: data.access_token, expires: Date.now() + Math.max(0, Number(data.expires_in || 0) - 300) * 1000 };
  return cached.token;
}
export async function verifySoter(openId: string, resultJSON: string, signature: string) {
  try {
    if (!env.wechatAppId || !env.wechatAppSecret) throw new Error('Soter unavailable');
    const token = await accessToken();
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/soter/verify_signature?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ openid: openId, json_string: resultJSON, json_signature: signature }),
    });
    const data = await response.json();
    if (data.errcode === 40001 || data.errcode === 42001) cached = undefined;
    if (!response.ok || data.is_ok !== true || (data.errcode && data.errcode !== 0)) throw new Error('Soter rejected');
  } catch {
    // Never log signature payloads, app credentials or upstream request URLs.
    throw new ApiError(403, '生物识别未通过服务端验证，请重试或使用 PIN', 'BIOMETRIC_REJECTED');
  }
}
