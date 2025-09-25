from __future__ import annotations

import hashlib
import httpx
from app.core.settings import settings


class WeChatService:
    async def exchange_code(
        self,
        code: str,
        nickname: str | None = None,
        avatar_url: str | None = None,
        open_id_hint: str | None = None,
    ) -> dict:
        if settings.wx_mock_mode or not settings.wx_app_id or not settings.wx_app_secret:
            if open_id_hint:
                open_id = open_id_hint
            else:
                hashed = hashlib.sha256(code.encode()).hexdigest()
                open_id = f'mock_{hashed[:24]}'
            return {
                'open_id': open_id,
                'union_id': None,
                'nickname': nickname or f'TeamKey用户{open_id[-4:]}',
                'avatar_url': avatar_url,
            }

        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params={
                    "appid": settings.wx_app_id,
                    "secret": settings.wx_app_secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("errcode"):
                raise ValueError(data.get("errmsg", "Invalid WeChat code"))
            return {
                'open_id': open_id_hint or data['openid'],
                'union_id': data.get('unionid'),
                'nickname': nickname,
                'avatar_url': avatar_url,
            }


wechat_service = WeChatService()
