# CodePool

CodePool 是一个给小团队使用的安全共享空间：集中保存常用代码片段、TOTP 动态验证码、一次性验证码、临时密文和备注。成员通过原生微信小程序随手取用，管理员通过 Web 控制台查看团队、内容元数据和审计记录。

## 新架构

```text
apps/
├── web/       Next.js：官网 + 管理端 + Route Handlers + SQLite 数据层
└── miniapp/   原生微信小程序：WXML + WXSS + JavaScript
docs/          产品、架构、安全、API 与设计文档
```

旧版的 FastAPI 后端、Vite 管理端和相互漂移的接口已移除。当前只有一个 Node.js 服务需要部署：Next.js 同时承载 Web 与 `/api/v1`，小程序继续保持微信原生实现。

## 本地启动

要求 Node.js 22+。

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
npm run db:init
npm run dev
```

打开：

- 官网：<http://localhost:3000>
- 管理控制台：<http://localhost:3000/admin>
- 健康接口：<http://localhost:3000/api/health>

开发默认管理员为 `admin@codepool.local` / `codepool-dev-only`。该默认值只允许非生产环境使用；生产启动前必须配置 `.env.example` 中的密钥和管理员凭据。

### 微信小程序

1. 用微信开发者工具导入 `apps/miniapp`。
2. 开发时在 `apps/miniapp/config.js` 设置本机或局域网 API 地址，并关闭合法域名校验。
3. 生产时配置 HTTPS 域名、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`，并关闭 `WECHAT_MOCK_LOGIN`。

## 常用命令

```bash
npm run dev          # 启动 Next.js 开发服务
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint
npm run build        # 生产构建
npm run check        # 类型检查 + 生产构建
npm run db:init      # 初始化/升级数据库
```

## 重要设计约束

- 内容正文和 TOTP 密钥使用 AES-256-GCM 加密后落库；列表和管理端只读取元数据。
- 这是“服务端可信”的加密存储，不宣称端到端加密。服务端需要短暂解密才能返回内容或计算 TOTP。
- 分享令牌只保存 SHA-256 摘要，默认 5 分钟、仅可领取一次。
- 小程序使用 Bearer JWT；管理端使用 `HttpOnly + SameSite=Strict` Cookie。
- SQLite 适合单实例自托管。多实例或 Serverless 部署应按 [架构文档](docs/ARCHITECTURE.md) 迁移到 PostgreSQL。

更多说明：[产品范围](docs/PRODUCT.md) · [技术架构](docs/ARCHITECTURE.md) · [安全模型](docs/SECURITY.md) · [API](docs/API.md) · [设计系统](docs/DESIGN.md)
