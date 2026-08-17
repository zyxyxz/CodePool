# CodePool

CodePool 是一个给小团队使用的安全共享空间：集中保存常用代码片段、TOTP 动态验证码、一次性验证码、临时密文和备注。成员通过原生微信小程序随手取用，运营人员通过 Web 控制台治理团队、用户、内容元数据、分享、邀请、审计和注销申请。

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

## 已具备的商用能力

- 运营后台：指标趋势、团队与所有权、用户封禁强退、内容治理、分享邀请撤销、安全审计、注销处理、运营配额和上线检查。
- 原生小程序：可靠登录、团队/角色、搜索筛选、内容与 TOTP 完整 CRUD、显式敏感值读取、分享领取、错误/离线/空状态、隐私与注销入口。
- 服务安全：AES-256-GCM、会话版本、持久限流、业务配额、原子分享/邀请、CSRF、安全响应头和默认 `no-store`。
- 运维交付：Docker 健康检查、追加式数据库迁移、加密一致性备份脚本、CI 和真实 HTTP 安全烟测。

## 重要设计约束

- 内容正文和 TOTP 密钥使用 AES-256-GCM 加密后落库；列表和管理端只读取元数据。
- 这是“服务端可信”的加密存储，不宣称端到端加密。服务端需要短暂解密才能返回内容或计算 TOTP。
- 分享令牌只保存 SHA-256 摘要；GET/HEAD 只预览且不消费，POST 才原子领取。
- 小程序使用 Bearer JWT；管理端使用 `HttpOnly + SameSite=Strict` Cookie。
- SQLite 适合单实例自托管。多实例或 Serverless 部署应按 [架构文档](docs/ARCHITECTURE.md) 迁移到 PostgreSQL。

## Dokploy 部署

仓库根目录的 `Dockerfile` 会生成 Next.js standalone 镜像，监听 `3000` 端口。生产环境需要将持久化卷挂载到 `/app/apps/web/data`，并配置 `.env.example` 中的生产变量。健康检查路径为 `/api/health`。

正式发布仍需要微信 AppSecret、运营主体、隐私指引/备案、异地备份和告警配置，详见[商用上线检查表](docs/LAUNCH_CHECKLIST.md)。

更多说明：[产品范围](docs/PRODUCT.md) · [技术架构](docs/ARCHITECTURE.md) · [安全模型](docs/SECURITY.md) · [API](docs/API.md) · [设计系统](docs/DESIGN.md) · [部署运维](docs/DEPLOYMENT.md)
