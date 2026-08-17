# 安全模型

## 信任边界

CodePool 采用服务端可信模型：客户端信任自托管的 Next.js 服务，服务端信任数据库文件所在主机。数据库泄露不应直接暴露正文，但服务器或主密钥完全失陷仍可解密内容。

## 已实现

- AES-256-GCM 认证加密，每次写入使用独立 96-bit IV。
- `CODEPOOL_MASTER_KEY` 与 JWT 密钥分离；生产环境拒绝短密钥或缺失密钥。
- TOTP 密钥只在计算时进入服务端内存，不经列表、详情、管理端或日志返回。
- 分享与邀请只落库 SHA-256 token 摘要。
- JWT 包含 issuer、audience、scope 和有效期。
- 管理端 Cookie 为 `HttpOnly`、`SameSite=Strict`，生产环境启用 `Secure`。
- 参数通过 Zod 校验；SQLite 查询全部使用参数绑定。
- 审计记录 IP 的截断哈希，不保存原始 IP。

## 上线前清单

1. 生成不同的随机 `CODEPOOL_MASTER_KEY` 与 `CODEPOOL_JWT_SECRET`，通过 secret manager 注入。
2. 设置强管理员密码，配置真实微信 AppID/Secret，关闭 mock 登录。
3. 只暴露 HTTPS，限制数据库文件权限，定期做加密备份和恢复演练。
4. 在反向代理或网关增加登录、验证码读取、分享领取的速率限制。
5. 设置日志保留周期并监控大量 `TOTP_VIEW`、`ITEM_REVEAL` 和失败登录。
6. 多实例部署前迁移 PostgreSQL，并使用集中式限流。

## 仍需补强

- 当前管理员凭据来自环境变量，适合单管理员自托管；企业场景应改为用户表、强哈希和 MFA。
- 当前没有内容级 ACL 和敏感操作二次确认。
- 当前没有主密钥轮换任务和 KMS 信封加密。
- 进程内没有可靠的分布式限流；生产必须在网关层补充。
