# Dokploy 生产部署

## 当前环境

- 生产域名：<https://codepool.apps.aisp24.com>
- 健康检查：<https://codepool.apps.aisp24.com/api/health>
- 发布分支：`main`
- 构建方式：仓库根目录 `Dockerfile`
- 容器端口：`3000`
- 数据卷：`/app/apps/web/data`
- 数据库：`/app/apps/web/data/codepool.db`
- 自动发布：push `main` → GitHub Actions 全量门禁 → Dokploy API 构建 → 生产健康检查

镜像使用非 root 用户运行，并通过容器 `HEALTHCHECK` 每 30 秒检查应用和数据库连通性。

## 环境变量

```dotenv
CODEPOOL_JWT_SECRET=
CODEPOOL_MASTER_KEY=
CODEPOOL_ADMIN_EMAIL=
CODEPOOL_ADMIN_PASSWORD=
CODEPOOL_DATABASE_PATH=/app/apps/web/data/codepool.db
CODEPOOL_TRUSTED_PROXY_HOPS=1
CODEPOOL_OPERATOR_NAME=
CODEPOOL_SUPPORT_EMAIL=
NEXT_PUBLIC_APP_URL=https://codepool.apps.aisp24.com
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_MOCK_LOGIN=false

# 加密备份
CODEPOOL_BACKUP_KEY=
CODEPOOL_BACKUP_DIR=/backup/codepool
```

JWT、数据主密钥和备份密钥必须使用三个独立的高强度随机值。已有业务数据后不能直接更换
`CODEPOOL_MASTER_KEY`，必须先完成重加密迁移。正式发布还必须配置运营主体与客服信息，
否则后台“上线检查”会持续显示阻断告警。

应用只使用可信反向代理追加的 `X-Forwarded-For` 计算限流与审计指纹。必须禁止容器端口直接
暴露公网，并确保 Dokploy/Traefik 丢弃客户端伪造的转发头。默认单层代理填写 `1`；若在
Dokploy 前还有 Cloudflare 等可信代理，则按真实链路调整 `CODEPOOL_TRUSTED_PROXY_HOPS`。

## 发布与回滚

1. 合并或推送到 `main` 后，GitHub Actions 执行 lint、typecheck、小程序静态检查、Next.js
   构建、安全烟测、依赖审计和 Docker 构建。
2. 只有 `verify` 与 `container` 同时通过，`deploy` 作业才把该次已验证 SHA 推进专用
   `production` 分支，再使用仓库密钥 `DOKPLOY_API_KEY` 调用 Dokploy API；Dokploy 自身的 push
   自动部署保持关闭，避免坏提交抢先上线。
3. Dokploy 只拉取 `production` 分支、构建镜像并启动新容器，CI 持续轮询部署终态。workflow
   并发策略为排队而非取消；晋级前会同时确认 Dokploy 部署记录与实际等待/执行队列为空。
   异常或超时时，CI 会中止尚未完成的入队请求、清除等待任务并复核连续静默窗口。Dokploy
   自托管 API 无法可靠终止已经 active 的应用部署；此时 CI 会失败关闭，后续发布在预检阶段
   持续阻断，直至该部署自然结束或由运维在 Dokploy 控制台处置，绝不继续覆盖生产分支。
4. 发布脚本把已验证 SHA 注入镜像；部署完成后，CI 验证 `/api/health` 返回同一 SHA、服务正常
   且数据库 ready，才将生产环境标为成功，旧副本不能冒充新版本通过验收。
5. 首次迁移前保留并验证加密备份；迁移执行后以向前修复方式处理故障。

v2/v3 的数据库结构是追加式迁移，但安全语义不兼容 v1 镜像：v1 不认识用户会话版本、团队
停用和内容治理状态。一旦新版本迁移完成并执行过任何停用、注销或治理操作，禁止回滚到 v1
镜像，否则旧会话可能重新获得访问。此后只能发布向前修复版本，或在维护窗口从迁移前的完整
数据库备份和对应镜像成对恢复。

部署 API 使用 HTTPS 和 GitHub Actions 加密仓库密钥。Dokploy push webhook 可以保留连接但必须
关闭 `autoDeploy`；生产部署只允许由通过质量门禁的 `deploy` 作业触发。应定期轮换部署凭据，
并将 API 权限限制在该应用所需的最小范围。

## SQLite 备份

持久卷不是备份。仓库使用 SQLite 在线备份生成一致性快照，再以常量内存的流式
AES-256-GCM 加密，适用于大数据库：

```bash
npm run db:backup
npm run db:verify-backup -- /absolute/path/to/codepool-xxx.cpbak
```

备份目录应挂载独立卷；脚本会按“数据库快照 + 加密文件 + 64 MiB 余量”预检空间，空间
不足会在写入前失败，避免挤满业务数据库卷。备份文件必须复制到异机或对象存储，并设置周期、保留期和失败告警。上线前至少进行一次真实
恢复演练；迁移数据库前先生成并验证备份。应用不会自行假装已完成基础设施备份，因此系统
后台在未接入外部备份状态时保持告警。

镜像已预建 `/backup/codepool` 并将其交给 UID 1001。Dokploy 使用命名卷时会继承该权限；若
使用宿主机 bind mount，必须在启动前将挂载目录设为 UID/GID 1001 且权限为 `0700`。

恢复时必须先停止应用写入。恢复到不存在的新路径不需要额外参数；替换现有数据库必须显式
传入 `--force`。强制恢复不会直接删除旧库，而会将数据库及 WAL/SHM 文件保留为带
`pre-restore` 时间戳的同目录文件，确认新库正常后再人工归档：

```bash
npm run db:restore -- /absolute/path/to/codepool-xxx.cpbak /app/apps/web/data/codepool.db --force
npm run db:verify-backup -- /absolute/path/to/codepool-xxx.cpbak
```

## 微信小程序上线

1. 在微信公众平台添加 `https://codepool.apps.aisp24.com` 为 request 合法域名。
2. 配置与 `project.config.json` AppID 对应的 AppSecret。
3. 完成微信隐私保护指引、用户协议、服务类目与小程序备案。
4. 使用体验版真机完成“登录 → 建团队 → 添加 → 按需读取 → 分享领取 → 注销申请”。
5. 保持 `WECHAT_MOCK_LOGIN=false`，再提交审核与发布。
