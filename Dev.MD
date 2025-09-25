# TeamKey 技术文档（服务端可信实现）

## 一、架构概览

**目标**：TeamKey 以微信小程序为前端入口，NestJS 提供 API，默认 SQLite 存储，Redis 做缓存，对象存储用于日志导出/审计文件。
**关键点**：

* 动态码（TOTP）在**服务端**按需计算并返回；
* 秘钥在数据库中**加密保存**（AES-256），支持两种密钥派生模式：

  * **基础模式（默认）**：服务端主密钥 KMS（`SERVER_MASTER_KEY`）→ 结合 `user_id/nonce` 派生每用户/每账号 DEK。
  * **增强模式（可选）**：用户 PIN 派生 KEK 包裹 DEK（不影响接口，升级平滑）。
* 管理后台仅做**系统配置与元数据查看**，不可触达明文秘钥。

---

## 二、模块划分

### 1) 前端（微信小程序）

* 技术栈：WXML + WXSS + TS
* 职责：

  * `wx.login` 登录，换取后端 JWT
  * 账户列表/分组/搜索/扫码添加（otpauth URI 或手输 secret）
  * 查看动态码（向后端拉取 TOTP）
  * 团队/成员管理、权限请求
  * 临时分享领取（一次性 token）

### 2) 后端 API（NestJS）

* 模块：

  * **Auth**：微信登录、JWT、设备指纹（可选）
  * **Team**：团队/成员/角色（RBAC）
  * **Account**：账号/秘钥入库（加密）、动态码计算
  * **Permission**：账号级授权（view/manage/temporary）
  * **Share**：临时分享（一次下载、默认5分钟过期）
  * **Audit/Log**：操作记录、导出报表
  * **Admin**：首次安装、系统配置、运行监控
* 安全：

  * 秘钥加密存储 AES-256-GCM
  * 传输全站 HTTPS + 小程序安全域
  * 敏感操作二次确认（短信/扫码/管理员确认，可按环境开关）

### 3) 数据层

* **数据库**：默认 SQLite（文件路径在 Admin 安装中配置）；可切换 MySQL/PostgreSQL
* **缓存**：Redis（会话、验证码窗口缓存、分享 token）
* **对象存储**：日志导出（CSV/JSON），审计归档

### 4) 管理后台（NestJS + 任意前端框架）

* 首次安装：管理员账号、站点 URL、数据库/Redis/Object Storage、小程序 AppID/Secret、KMS 主密钥注入方式
* 运行监控：版本、任务队列、错误告警
* 数据可视：用户/团队/账户元数据、权限图谱、审计概览
* **无秘钥明文能力**，也不暴露动态码接口

### 5) 安全层（密钥管理与派生）

* **基础模式（默认）**

  * 环境变量提供 `SERVER_MASTER_KEY`（或托管于 KMS）
  * `DEK_user_account = KDF(SERVER_MASTER_KEY, user_id || account_id || random_salt)`
  * 写库：`secret_enc = AES-GCM(DEK_user_account, secret_plain)`
  * 读库：解密后在内存计算 TOTP，**不落盘**、**不日志**、**不缓存明文**
* **增强模式（可选）**

  * 用户 PIN → `KEK_user = Argon2(PIN, salt_user)`
  * 生成随机 `DEK_user_account`，用 `KEK_user` 包裹并存库（或用服务器 KEK 进行二层包裹，双包结构）
  * 需要时先解包 DEK，再解密 secret
  * 好处：即便 DB 泄露也很难复原明文（需要 PIN）

---

## 三、接口设计（REST，示例载荷）

> 统一返回：`{ code: 0, data: {...}, msg: "" }`
> 鉴权：除 `/auth/login`、`/share/{token}` 外均需 Bearer JWT。

### A. Auth 鉴权

* `POST /auth/login`

  * Req：`{ wx_code }`
  * Flow：服务端用 `wx_code` 换 openid → upsert 用户 → 颁发 JWT
  * Res：`{ token, user: { id, openid, nickname, avatar } }`

* `GET /auth/me`

  * Res：当前用户资料与所属团队摘要

### B. Teams 团队

* `POST /teams`

  * Req：`{ name }`
  * Res：`{ id, name, owner_id, created_at }`

* `GET /teams`

  * Res：用户所在团队列表（角色附带）

* `POST /teams/{teamId}/invite`

  * Req：`{ invitee_contact, role }`（手机号/微信号）
  * Side effect：生成邀请记录/通知

* `DELETE /teams/{teamId}/members/{userId}`

  * 权限：team.owner / admin

### C. Accounts 账号与动态码

* `POST /accounts`

  * 权限：team admin / account manager
  * Req（两种）：

    1. `otpauth_url`（推荐）
    2. 手动：`{ issuer, label, secret, algo='SHA1', digits=6, period=30 }`
  * Flow：校验 → 解析 → **服务端加密入库** → 写审计
  * Res：`{ id, team_id, issuer, label, created_by }`

* `GET /accounts?team_id=&q=&page=&size=`

  * Res：账号元数据列表（不含秘钥）

* `GET /accounts/{accountId}`

  * Res：账号详情（不含秘钥参数；可返回算法/位数/周期等配置）

* `GET /accounts/{accountId}/code`

  * 权限：有 `view` 或更高
  * Flow：解密 secret → 计算 TOTP（RFC6238）→ 返回当前时间窗口值，并给出下一次过期秒数
  * Res：`{ code: "123456", valid_for: 17 }`

* `DELETE /accounts/{accountId}`

  * 权限：manage

### D. Permissions 权限

* `GET /accounts/{accountId}/permissions`

  * Res：用户-权限列表（`view`/`manage`/`temporary`）

* `PATCH /accounts/{accountId}/permissions`

  * 权限：team admin / account manager
  * Req：`{ grants: [{ user_id, permission, expires_at? }], revokes: [user_id...] }`

### E. Share 临时分享

* `POST /accounts/{accountId}/share`

  * 权限：有 `manage` 或 `view`（可配置“仅管理员可分享”）
  * Req：`{ expires_in_sec = 300, one_time = true }`
  * Flow：生成一次性 token，Redis 记录；**不返回明文秘钥**，由服务端在领取时计算 TOTP 或下发一次性加密包（按策略）
  * Res：`{ token, expire_at }`

* `GET /share/{token}`

  * 无需 JWT（一次性匿名领取）
  * **两种策略（二选一，按安全策略开关）**

    1. **只返 TOTP 值**：`{ code, valid_for }`（安全更高，不扩散秘钥）
    2. **返一次性加密包**（用于跨系统迁移）：`{ secret_enc, meta, expire_at }`（领取即作废）
  * 领取后：标记使用 + 失效

### F. Logs 审计

* `GET /logs?team_id=&action=&user_id=&page=&size=`

  * Res：日志分页

* `POST /logs/export`

  * 权限：team admin
  * Flow：导出到对象存储，返回下载地址（带签名有效期）

### G. Admin 安装与配置（仅后台）

* `POST /admin/setup`

  * Req：站点 URL、数据库/Redis/ObjectStorage 配置、小程序 AppID/Secret、`SERVER_MASTER_KEY` 注入方式
* `POST /admin/login`
* `GET /admin/users` / `GET /admin/teams` / `GET /admin/health`

> **说明**：后台接口仅用于系统配置与元数据浏览，不提供动态码/秘钥访问。

---

## 四、数据库设计（SQLite / MySQL / PG 通用）

> 字段类型以通用表示，实际按所用数据库做微调（自增/时间默认值等）。

### 1) `users`

| 字段              | 类型           | 约束 | 说明        |
| --------------- | ------------ | -- | --------- |
| id              | bigint PK    | AI | 用户ID      |
| openid          | varchar(64)  | UQ | 微信 OpenID |
| nickname        | varchar(64)  |    | 昵称        |
| avatar          | varchar(255) |    | 头像        |
| created\_at     | datetime     |    | 创建时间      |
| last\_login\_at | datetime     |    | 最近登录      |

### 2) `teams`

| 字段          | 类型          | 约束          | 说明   |
| ----------- | ----------- | ----------- | ---- |
| id          | bigint PK   | AI          | 团队ID |
| name        | varchar(64) |             | 团队名  |
| owner\_id   | bigint      | FK→users.id | 创建者  |
| created\_at | datetime    |             | 创建时间 |

### 3) `team_members`

| 字段         | 类型                             | 约束 | 说明   |
| ---------- | ------------------------------ | -- | ---- |
| id         | bigint PK                      | AI | 主键   |
| team\_id   | bigint                         | FK | 团队   |
| user\_id   | bigint                         | FK | 成员   |
| role       | enum('admin','member','guest') |    | 角色   |
| joined\_at | datetime                       |    | 加入时间 |
| UQ         | (team\_id,user\_id)            |    | 去重   |

### 4) `accounts`

| 字段          | 类型                             | 约束          | 说明                  |
| ----------- | ------------------------------ | ----------- | ------------------- |
| id          | bigint PK                      | AI          | 账号ID                |
| team\_id    | bigint                         | FK          | 所属团队                |
| issuer      | varchar(64)                    |             | 服务提供方（如 GitHub）     |
| label       | varchar(128)                   |             | 账户标识（如 email/login） |
| algo        | enum('SHA1','SHA256','SHA512') |             | TOTP 算法             |
| digits      | tinyint                        |             | 位数（6/8）             |
| period      | tinyint                        |             | 步长（默认30）            |
| secret\_enc | text                           |             | **加密后的秘钥**（密文）      |
| salt        | varbinary(32)                  |             | KDF 盐（派生 DEK 用）     |
| created\_by | bigint                         | FK→users.id | 创建人                 |
| created\_at | datetime                       |             | 创建时间                |
| updated\_at | datetime                       |             | 更新时间                |
| idx         | (team\_id, issuer, label)      |             | 检索优化                |

> **secret\_enc** 为 AES-GCM 密文（建议封装为含 `iv, tag, ciphertext, version` 的 JSON 再存）。

### 5) `account_permissions`

| 字段          | 类型                                | 约束 | 说明     |
| ----------- | --------------------------------- | -- | ------ |
| id          | bigint PK                         | AI | 主键     |
| account\_id | bigint                            | FK | 账号     |
| user\_id    | bigint                            | FK | 用户     |
| permission  | enum('view','manage','temporary') |    | 权限     |
| expires\_at | datetime                          |    | 临时授权过期 |
| UQ          | (account\_id,user\_id)            |    | 去重     |

### 6) `shares`

| 字段                | 类型                     | 约束          | 说明                     |
| ----------------- | ---------------------- | ----------- | ---------------------- |
| id                | bigint PK              | AI          | 分享ID                   |
| account\_id       | bigint                 | FK          | 账号                     |
| token             | varchar(64)            | UQ          | 一次性领取 token（也可放 Redis） |
| mode              | enum('code','package') |             | “仅TOTP值” 或 “一次性密包”     |
| secret\_enc\_once | text                   |             | （可空）一次性密包              |
| expires\_at       | datetime               |             | 过期时间（默认 5 分钟）          |
| used              | boolean                |             | 是否已使用                  |
| created\_by       | bigint                 | FK→users.id | 发起人                    |
| created\_at       | datetime               |             | 创建时间                   |

### 7) `audit_logs`

| 字段           | 类型                              | 约束 | 说明                                       |
| ------------ | ------------------------------- | -- | ---------------------------------------- |
| id           | bigint PK                       | AI | 日志ID                                     |
| team\_id     | bigint                          | FK | 团队                                       |
| user\_id     | bigint                          | FK | 操作人                                      |
| action       | varchar(64)                     |    | 动作（CREATE\_ACCOUNT/VIEW\_CODE/SHARE/...） |
| target\_type | varchar(32)                     |    | 对象类型（account/user/team/share）            |
| target\_id   | bigint                          |    | 对象ID                                     |
| meta         | json                            |    | 附加信息（IP、UA 等）                            |
| created\_at  | datetime                        |    | 时间戳                                      |
| idx          | (team\_id, action, created\_at) |    | 检索优化                                     |

### 8) `admin_settings`

| 字段                        | 类型           | 约束 | 说明                    |
| ------------------------- | ------------ | -- | --------------------- |
| id                        | int PK       |    | 单行配置                  |
| site\_url                 | varchar(255) |    | 站点URL                 |
| db\_dsn                   | varchar(255) |    | 数据库连接（默认 SQLite 文件路径） |
| redis\_dsn                | varchar(255) |    | Redis                 |
| oss\_conf                 | json         |    | 对象存储配置                |
| wx\_appid                 | varchar(64)  |    | 小程序 AppID             |
| wx\_secret                | varchar(64)  |    | 小程序 Secret（加密存）       |
| kms\_conf                 | json         |    | KMS/主密钥来源             |
| installed                 | boolean      |    | 是否已完成初始化              |
| created\_at / updated\_at | datetime     |    |                       |

---

## 补充：服务端 TOTP 与缓存策略

* 计算：RFC 6238（HMAC-SHA1/256/512 可配），默认 30s 窗口，支持 ±1 窗口容错（可选）
* 缓存：同一账号同一窗口的 TOTP 可在内存短暂缓存（≤窗口期），但**不要缓存明文 secret**
* 速率限制：对 `/accounts/{id}/code` 做用户与 IP 维度限流（如 10 req/30s）

---

## 补充：未来安全升级（不破坏接口）

* 开启 **增强模式（用户 PIN 包裹 DEK）**：仅更改 `secret_enc` 的内部封装与解包流程
* 开启 **“仅返回 TOTP，不允许密包分享”**：后端配置开关，Share API 的 `mode` 固定为 `code`
* 引入 **审计不可抵赖**：关键操作加签（Ed25519）留存签名

