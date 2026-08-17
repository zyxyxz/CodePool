# Dokploy 部署

CodePool 生产环境由 Dokploy 托管，使用仓库根目录的 `Dockerfile` 构建 Next.js standalone 镜像。

## 当前生产配置

- 生产域名：<https://codepool.apps.aisp24.com>
- 健康检查：<https://codepool.apps.aisp24.com/api/health>
- Git 分支：`main`
- 容器端口：`3000`
- 数据卷：`/app/apps/web/data`
- 数据库：`/app/apps/web/data/codepool.db`
- 自动部署：GitHub `push` webhook 触发 Dokploy 构建和发布

## 必需环境变量

在 Dokploy 中配置以下变量，不要提交实际值：

```dotenv
CODEPOOL_JWT_SECRET=
CODEPOOL_MASTER_KEY=
CODEPOOL_ADMIN_EMAIL=
CODEPOOL_ADMIN_PASSWORD=
CODEPOOL_DATABASE_PATH=/app/apps/web/data/codepool.db
NEXT_PUBLIC_APP_URL=https://codepool.apps.aisp24.com
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_MOCK_LOGIN=false
```

`CODEPOOL_JWT_SECRET` 和 `CODEPOOL_MASTER_KEY` 应使用独立的高强度随机值。更换
`CODEPOOL_MASTER_KEY` 前必须先迁移已有密文，否则旧数据将无法解密。

## 发布流程

1. 变更合并或直接推送到 `main`。
2. GitHub webhook 通知 Dokploy。
3. Dokploy 从 `main` 拉取代码并构建根目录 `Dockerfile`。
4. 新容器通过健康检查后接管生产流量。
5. 发布后访问 `/api/health`，确认返回 `status: ok`。

Dokploy webhook 的接收地址必须能被 GitHub 公网访问。管理面板若只通过内网或
Tailscale 暴露，需要额外提供仅用于 webhook 的公网入口。

## 微信小程序上线前

在微信公众平台把 `https://codepool.apps.aisp24.com` 添加为 request 合法域名，并在
Dokploy 配置真实的 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。生产环境必须保持
`WECHAT_MOCK_LOGIN=false`。
