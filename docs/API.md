# CodePool API

所有响应使用统一信封：

```json
{ "code": 0, "data": {}, "msg": "" }
```

业务失败同时使用对应 HTTP 状态码；触发限流时返回 `429` 和 `Retry-After`。所有 API
JSON API 响应默认 `Cache-Control: no-store`；头像二进制响应使用私有缓存并在每次复用前以
ETag 重新验证。

## 成员 API `/api/v1`

除登录和匿名分享外，请携带 `Authorization: Bearer <token>`。成员会话包含版本号；账号
停用或注销后，已签发令牌会立即失效。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 微信 code 登录；首次登录创建默认团队 |
| GET | `/config` | 公共运营配置、公告、维护状态和安全配额，不含秘密 |
| GET/PATCH | `/auth/me` | 当前成员、团队和角色，或更新昵称 |
| POST | `/auth/avatar` | 上传并净化头像；仅限 JPEG、PNG、WebP，原图不超过 512 KiB |
| GET | `/avatars/:userId` | 使用成员 API 下发的短时 HMAC 地址读取头像；签名失效、停用或注销后返回 404 |
| GET/POST/DELETE | `/auth/deletion-request` | 查询、提交或撤回注销申请 |
| GET/POST | `/teams` | 团队列表或创建团队 |
| GET | `/teams/:id/members` | 团队成员列表 |
| PATCH/DELETE | `/teams/:id/members/:userId` | 调整角色或移除成员 |
| GET/POST | `/teams/:id/invites` | 邀请列表或创建邀请 |
| POST | `/teams/invites/:token/accept` | 原子领取一次性邀请 |
| GET/POST | `/items` | 通用内容列表或创建内容 |
| GET/PATCH/DELETE | `/items/:id` | 显式读取、更新或删除内容 |
| GET/POST | `/accounts` | TOTP 列表或导入 |
| GET/PATCH/DELETE | `/accounts/:id` | TOTP 元数据管理，不返回密钥 |
| GET | `/accounts/:id/code` | 按需计算当前动态码 |
| GET/POST | `/shares` | 分享历史或创建限时分享 |
| GET | `/shares/public/:token` | 仅返回无敏感值预览，不消耗次数 |
| HEAD | `/shares/public/:token` | 仅探测是否可领取，不消耗次数 |
| POST | `/shares/public/:token` | 显式、原子领取一次分享 |
| GET | `/audit/logs?teamId=` | 团队审计日志 |

列表页不会自动返回正文或动态码。普通内容详情和动态码必须分别通过显式读取接口获取。
维护模式下，新增、编辑、邀请领取和匿名分享领取返回 `503 MAINTENANCE_MODE`；撤销、删除和
注销操作仍可用于止损与履行用户权利。

## 运营 API `/api/admin`

运营 API 使用 `HttpOnly + Secure + SameSite=Strict` 管理员 Cookie。所有变更请求校验
Origin/Host/Proto，并写入脱敏审计日志。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/login` | 管理员登录，带持久限流与失败审计 |
| POST | `/logout` | 退出并清除 Cookie |
| GET | `/overview` | 指标、趋势、内容构成、风险事项 |
| GET/POST | `/teams` | 搜索分页、创建团队 |
| GET/PATCH | `/teams/:id` | 详情、停用恢复、重命名、转移所有权 |
| GET | `/users` | 搜索、分页和状态筛选 |
| GET/PATCH | `/users/:id` | 用户详情、停用恢复、强制会话失效 |
| GET | `/items` | 内容元数据治理列表 |
| PATCH/DELETE | `/items/:id` | 停用恢复或永久删除 |
| GET | `/shares` | 分享记录与状态筛选 |
| DELETE | `/shares/:id` | 撤销分享 |
| GET | `/invites` | 邀请记录与状态筛选 |
| DELETE | `/invites/:id` | 撤销邀请 |
| GET | `/audit` | 审计筛选、分页与安全导出数据 |
| GET/PATCH | `/settings` | 运营开关、配额和默认有效期 |
| GET | `/system` | 服务、数据库、安全与上线检查 |
| GET | `/deletion-requests` | 注销申请分页与状态统计 |
| PATCH | `/deletion-requests/:id` | 批准、驳回或完成匿名化注销 |

运营 API 永远不会返回正文、TOTP 密钥、加密字段、分享/邀请令牌、OpenID、UnionID 或
原始 IP。

## 关键错误

```json
{ "code": 403, "data": null, "msg": "当前角色没有此操作权限", "error": "FORBIDDEN" }
```

- `401 UNAUTHORIZED`：会话过期、被停用或版本失效。
- `403 FORBIDDEN`：角色或团队状态不允许操作。
- `409`：资源状态冲突，例如注销前仍拥有活跃团队。
- `410`：分享或邀请已过期、撤销、使用或领取完毕。
- `413 PAYLOAD_TOO_LARGE`：普通 JSON 请求体超过 256 KiB；头像请求信封上限为 768 KiB，
  解码后的原图上限为 512 KiB。
- `422 INVALID_AVATAR_DATA`：头像数据、文件类型或图片尺寸不符合要求。
- `429 RATE_LIMITED`：请求过于频繁；按 `Retry-After` 重试。
