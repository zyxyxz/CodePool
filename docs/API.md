# API 摘要

所有小程序业务接口前缀为 `/api/v1`。除登录和匿名分享外，需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 微信 code 换取 JWT；首次登录创建默认池 |
| GET | `/auth/me` | 当前成员与团队 |
| GET/POST | `/teams` | 列出或创建团队池 |
| GET | `/teams/:id/members` | 成员列表 |
| PATCH/DELETE | `/teams/:id/members/:userId` | 修改角色或移除成员 |
| GET/POST | `/teams/:id/invites` | 邀请列表或创建邀请 |
| POST | `/teams/invites/:token/accept` | 接受邀请 |
| GET/POST | `/items` | 通用内容列表或创建内容 |
| GET/PATCH/DELETE | `/items/:id` | 显式读取、更新或删除内容 |
| GET/POST | `/accounts` | 小程序兼容的 TOTP 列表或导入 |
| GET/PATCH/DELETE | `/accounts/:id` | TOTP 元数据管理，不返回密钥 |
| GET | `/accounts/:id/code` | 计算当前 TOTP |
| GET/POST | `/shares` | 分享历史或创建分享 |
| GET | `/shares/public/:token` | 匿名限次领取 |
| GET | `/audit/logs?teamId=` | 团队审计日志 |

失败响应保留相同信封，HTTP 状态码表达错误类型：

```json
{ "code": 403, "data": null, "msg": "当前角色没有此操作权限", "error": "FORBIDDEN" }
```
