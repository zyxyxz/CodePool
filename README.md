# TeamKey 全栈实现指南

本仓库包含 TeamKey 的三大组成部分：

- `TeamKey_backend` —— NestJS + TypeORM 服务端，实现微信登录、团队/账号管理、TOTP 计算、审计与分享接口。
- `TeamKey_miniapp` —— 微信小程序端，面向团队成员的动态码协作工具。
- `TeamKey_Admin_frontend` —— React + Ant Design 管理后台，实现安装向导、运营监控与系统配置。

> 设计与实现遵循 `Product.MD`、`Dev.MD`、`UIDesign.MD`、`UIDesign_Admin.MD` 中的要求，整体风格偏年轻、卡片化。

---

## 1. 环境准备

### 1.1 服务端

1. 进入 `TeamKey_backend`
2. 安装依赖：`npm install`
3. 复制 `.env.example` 为 `.env`，按需修改：
   - `SQLITE_PATH`：默认存储到 `data/teamkey.db`
   - `JWT_SECRET`、`SERVER_MASTER_KEY`：请替换为安全随机值
   - `WX_APPID` / `WX_SECRET`：正式接入微信时填写；本地调试可保持 `WX_MOCK_MODE=true`
4. 启动服务：
   ```bash
   npm run start:dev
   ```
5. 默认监听 `http://localhost:3000`

### 1.2 小程序端

1. 在微信开发者工具中导入 `TeamKey_miniapp`
2. 配置「不校验合法域名」、并在 `config.js` 中将 `BASE_URL` 指向后端地址
3. 首次编译会自动登录（使用微信 `wx.login` + 后端 mock 登录流程）
4. 主要页面：
   - 首页：团队账号列表 + 动态验证码 + 倒计时刷新
   - 团队：成员列表、邀请、角色调整
   - 日志：操作时间线
   - 我的：账号信息、刷新凭据、退出登录

### 1.3 管理后台

1. 进入 `TeamKey_Admin_frontend`
2. 安装依赖：`npm install`
3. 创建 `.env`（可选）配置 `VITE_API_BASE_URL`，缺省为 `http://localhost:3000`
4. 启动：
   ```bash
   npm run dev
   ```
5. 访问 `http://localhost:5173`

首次登录：
- 使用 `.env` 中的 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 登录
- 若系统未初始化，将自动跳转到安装向导（填写站点、数据库、对象存储、小程序配置等）

---

## 2. 核心能力概览

### 2.1 后端模块

| 模块 | 说明 |
| ---- | ---- |
| Auth | 微信 `wx.login` 登录、JWT 签发、`/auth/me` 回传团队摘要 |
| Teams | 团队创建、成员/角色管理、邀请令牌生成 |
| Accounts | TOTP 账号入库、AES-256-GCM 加密秘钥、动态码计算 |
| Permissions | 账号级权限（view/manage/temporary），与团队角色联动 |
| Shares | 一次性分享令牌，可按配置返回动态码或密包 |
| Audit | 操作日志落库，供小程序 / 管理后台查询 |
| Admin | 初始化、系统配置获取/更新、统计、用户/团队/资产/日志列表 |

密钥管理：
- 统一使用 `SERVER_MASTER_KEY` 派生 DEK，AES-256-GCM 存储 `secret_enc`
- share「密包」模式将一次性秘钥打包为 base64（可按需替换为 KMS）

### 2.2 小程序体验亮点

- **卡片式验证码**：30s 倒计时 + 进度条，自动刷新
- **团队切换**：顶部团队选择器 + 搜索
- **角色操作**：长按成员卡片修改角色或移除
- **分享**：一次性口令弹窗（5 分钟有效）
- **安全提示**：网络失败、未授权均 Toast 提示

### 2.3 管理后台能力

- **控制台**：统计卡片 + 最近操作表格
- **列表管理**：用户、团队、账号资产、审计日志支持分页/搜索
- **设置中心**：可视化修改站点、数据库、OSS、小程序配置、管理员凭据
- **安装向导**：首次登录后快速完成基础配置
- **统一主题**：科技紫渐变、圆角卡片、深浅双模式友好

---

## 3. 接口速览

- `POST /auth/login`：微信登录（mock 模式直接根据 code 生成 openId）
- `GET /accounts/:id/code`：返回动态验证码 `{ code, expiresIn, period }`
- `POST /shares` / `GET /share/:token`：一次性分享码申请与领取
- `GET /admin/*`：管理后台数据接口（需 `Authorization: Bearer <admin-token>`）

默认响应结构：`{ code: 0, data: {...} }`，但也兼容直接返回实体（兼容前端开发便捷性）

---

## 4. 开发/测试建议

1. **数据重置**：SQLite 默认存储在 `TeamKey_backend/data/teamkey.db`，开发时可直接删除文件。
2. **安全检查**：上线前务必替换全部默认密钥，并接入真实微信 AppID/Secret。
3. **分享模式**：目前默认支持 `code` / `package` 两种模式，其中 `package` 以 base64 JSON 返回一次性秘钥，生产环境建议拓展 KMS。
4. **管理员初始口令**：登录后尽快在「系统设置」中修改管理员密码。
5. **CI/CD**：建议为 backend 添加 `npm run build`（TypeScript 检查）和基础 API 测试，前端使用 `npm run build` 验证打包。

---

## 5. 下一步可扩展项

- 接入短信 / 邮件验证码托管（`Product.MD` V2.0 规划）
- 引入 Redis 缓存 `TOTP` 窗口、速率限制中间件
- 分享日志图形化展示（admin 控制台）
- 审计日志导出 CSV / 对象存储下载
- 小程序暗色主题、自定义品牌色

---

如需更多帮助，可基于现有模块继续拓展。祝使用顺利！
