import { db } from './db';

export function walletName(nickname: string) {
  let prefix = '';
  for (const character of nickname.trim()) {
    if (prefix.length + character.length > 42) break;
    prefix += character;
  }
  return `${prefix}的密钥钱包`;
}

// Only automatic personal-space names track nicknames; custom names stay intact.
export function renameDefaultWallet(userId: string, previousNickname: string, nickname: string) {
  db.prepare(`UPDATE teams SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE owner_id = ? AND slug = ? AND name IN (?, '我的代码池', '我的密钥钱包')`)
    .run(walletName(nickname), userId, `pool-${userId.slice(0, 12)}`, walletName(previousNickname));
}
