# 用户与设备审核机制说明

更新时间：2026-05-20

## 文档定位

本文不再是“待实现设计稿”，而是按当前源码整理用户审核、设备审核和 `auth_code` 设备归属的实际实现。

主要实现入口：

- `db/init.sql`
- `webserver/server/src/index.js`
- `webserver/server/src/auth/user-service.js`
- `webserver/server/src/auth/auth-code-service.js`
- `webserver/server/src/agents/managed-agent-service.js`
- `webserver/server/src/db/schema-service.js`
- `webserver/client/src/components/ProfileTab.vue`
- `webserver/client/src/stores/console.js`
- `localapp/src/agent-client.js`

## 当前已落地能力

当前审核能力已经落地，不再是“建议新增”：

- 公开注册可配置为待审核账号。
- 登录会区分密码错误、待审核、已拒绝、已停用。
- 管理员可审核通过 / 拒绝用户。
- 管理员可创建已通过用户、修改角色/启停、重置密码。
- `localapp` 注册时会上报本机 RSA 公钥和指纹。
- 服务端可把新设备登记到 `managed_agents`，并按审核状态决定是否允许进入正式在线设备列表。
- 设备公钥指纹变化时，服务端会废弃旧当前记录并创建新的待审核记录。
- `auth_code` 按 `agentId` 做全局唯一绑定，同一设备不能被多个用户重复绑定。
- 管理员可查看全部 `auth_code` 归属并强制解绑。

## 配置开关

服务端环境变量：

```env
ALLOW_PUBLIC_REGISTRATION=true
REGISTRATION_APPROVAL_REQUIRED=false
AGENT_APPROVAL_REQUIRED=false
```

含义：

- `ALLOW_PUBLIC_REGISTRATION=false`：关闭公开注册入口。
- `REGISTRATION_APPROVAL_REQUIRED=true`：公开注册账号进入 `pending`，管理员审核通过后才能登录。
- `AGENT_APPROVAL_REQUIRED=true`：agent 注册必须经过 `managed_agents` 审核，未审核设备不会进入正式在线设备列表。

注意当前代码中的一个实际约束：

- `auth_code` 创建 / 更新会要求目标设备在 `managed_agents` 中是 `approved + enabled`。
- 因此实际联调建议开启 `AGENT_APPROVAL_REQUIRED=true` 并完成设备审核，或确保数据库中已有对应的已批准设备记录。

## 用户审核

### 数据模型

`users` 表当前已有审核字段：

- `approval_status`：`pending` / `approved` / `rejected`
- `registration_source`：`public` / `admin` / `system`
- `application_note`
- `approved_at`
- `approved_by_user_id`
- `rejected_at`
- `rejected_by_user_id`
- `review_comment`
- `is_active`

状态语义：

- `pending`：已提交申请，不能登录。
- `approved + is_active = 1`：可登录。
- `approved + is_active = 0`：已通过但被停用，不能登录。
- `rejected`：申请被拒绝，不能登录。

默认管理员账号由 `db/init.sql` 写入为 `approved`。

### 注册与登录

公开注册入口：

- `POST /api/auth/register`

当前行为：

- `ALLOW_PUBLIC_REGISTRATION=false` 时返回 403。
- `REGISTRATION_APPROVAL_REQUIRED=true` 时创建 `pending` 用户，返回 HTTP 202 和“注册申请已提交，等待管理员审核”。
- `REGISTRATION_APPROVAL_REQUIRED=false` 时创建 `approved` 用户，返回 HTTP 201。
- 公开注册支持可选 `applicationNote`。

登录入口：

- `POST /api/auth/login`

当前失败原因区分：

- 用户名或密码错误：401，`用户名或密码错误`
- 待审核：403，`账号待管理员审核`
- 已拒绝：403，`账号申请未通过，请联系管理员`
- 已停用：403，`账号已停用`

### 管理员接口

当前已实现：

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/approve`
- `POST /api/users/:id/reject`
- `POST /api/users/:id/reset-password`

会话清理：

- 用户修改自己的密码后，服务端会清理该用户所有 session，并让当前浏览器退出。
- 管理员重置密码、禁用用户、拒绝用户时，会清理该用户所有 session，并断开其浏览器 WebSocket。

## 设备审核

### 数据模型

`managed_agents` 表当前已落地，核心字段包括：

- `agent_id`
- `record_status`：当前主要使用 `current` / `superseded`
- `label`
- `hostname`
- `platform`
- `arch`
- `auth_public_key`
- `auth_public_key_fingerprint`
- `approval_status`：`pending` / `approved` / `rejected`
- `is_enabled`
- `application_note`
- `review_comment`
- `approved_at`
- `approved_by_user_id`
- `rejected_at`
- `rejected_by_user_id`
- `first_seen_at`
- `last_seen_at`
- `last_seen_ip`
- `superseded_at`
- `superseded_by_agent_record_id`

服务启动时 `SchemaService.ensureApprovalSchema()` 会补齐审核字段、`managed_agents` 表，以及 `user_auth_codes.agent_id` 的全局唯一索引。

### agent 上报内容

`localapp` 在 `agent.register` 中会上报：

- `agentId`
- `label`
- `hostname`
- `platform`
- `arch`
- `pid`
- `authPublicKey`
- `authPublicKeyFingerprint`
- `applicationNote`
- `activeTerminalSessions`
- `terminalProfiles`
- `presetCommands`
- `commonWorkingDirectories`

`authPublicKey` 来自本机 `AUTH_PRIVATE_KEY_PATH` 对应私钥导出的公钥，服务端会规范化并重新计算指纹。如果上报指纹与服务端计算结果不一致，注册会被拒绝。

### 注册处理流程

当 `AGENT_APPROVAL_REQUIRED=false`：

- 服务端仍校验 URL 上的共享 token。
- `agent.register` 可直接进入正式在线注册表。

当 `AGENT_APPROVAL_REQUIRED=true`：

1. 首次上报的 `agentId + auth_public_key_fingerprint` 会写入 `managed_agents`，状态为 `pending`。
2. 服务端发送 `agent.access.pending` 后断开连接。
3. 管理员审核通过后，下一次相同 `agentId + 指纹` 连接才会进入正式在线设备列表。
4. 若当前记录是 `rejected`，服务端发送 `agent.access.rejected` 后断开。
5. 若当前记录 `is_enabled = false`，服务端发送 `agent.access.disabled` 后断开。
6. 若已批准设备上报了新的公钥指纹，服务端创建新的 `pending` 记录，将旧记录标记为 `superseded`，发送 `agent.access.reverify_required` 后断开。

agent 侧已能处理这些服务端控制消息：

- `agent.access.pending`
- `agent.access.rejected`
- `agent.access.disabled`
- `agent.access.reverify_required`

### 管理员接口

当前已实现：

- `GET /api/managed-agents`
- `POST /api/managed-agents/:id/approve`
- `POST /api/managed-agents/:id/reject`
- `PATCH /api/managed-agents/:id`

`PATCH /api/managed-agents/:id` 当前可更新：

- `label`
- `applicationNote`
- `reviewComment`
- `isEnabled`

拒绝设备或停用设备时，如果该设备当前在线，服务端会发送访问控制消息并断开它。

## `auth_code` 设备归属

当前 `auth_code` 语义已经收紧为“设备级唯一归属”：

- `user_auth_codes` 仍保存用户、`agentId`、公钥 PEM 和备注。
- `db/init.sql` 中已有 `UNIQUE KEY uk_user_auth_codes_agent_id (agent_id)`。
- 服务启动时也会尝试补齐该唯一索引；如果发现历史重复数据，会记录日志并跳过补索引。
- 同一个 `agentId` 只能存在一条有效 `auth_code`。
- 普通用户不能抢占其他用户已绑定的设备。
- 管理员可通过 `DELETE /api/admin/auth-codes/:id` 强制解绑。

创建 / 更新 `auth_code` 时，服务端会：

1. 校验 `agentId` 非空。
2. 查找对应 `managed_agents` 当前记录。
3. 要求设备 `approvalStatus === "approved"` 且 `isEnabled === true`。
4. 规范化 RSA 公钥 PEM。
5. 计算 SHA-256 指纹。
6. 检查该 `agentId` 是否已被其他用户绑定。
7. 写入 `user_auth_codes`。

## 前端入口

当前管理入口集中在“我的”页面：

- 公开注册页支持申请备注。
- 管理员区域展示用户列表、审核状态、审核备注、通过/拒绝、启停和重置密码。
- 管理员区域展示设备审核列表、设备公钥指纹、申请备注、审核备注、通过/拒绝、启停。
- 管理员可查看设备绑定归属并强制解绑。
- 普通用户可新增、编辑、删除自己的 `auth_code` 绑定。

相关文件：

- `webserver/client/src/components/AuthScreen.vue`
- `webserver/client/src/components/ProfileTab.vue`
- `webserver/client/src/stores/console.js`

## 当前边界

- 审核机制不是细粒度 RBAC，当前角色仍是 `admin / operator / viewer`。
- 审核机制不是命令白名单，也不做命令执行前人工审批。
- `AGENT_SHARED_TOKEN` 仍是连接握手的粗粒度入口；没有安装码 / 邀请码机制。
- 未审核设备在开启 `AGENT_APPROVAL_REQUIRED=true` 后不能进入正式在线列表，但仍可能发起连接申请。
- 当前没有完整历史审计事件表，审核动作主要记录在当前状态字段和结构化日志中。
- 设备换钥后不会自动改写用户已有 `auth_code`，绑定用户需要确认并更新公钥。

## 推荐使用方式

生产环境建议：

- `ALLOW_PUBLIC_REGISTRATION=false`，或开启 `REGISTRATION_APPROVAL_REQUIRED=true`。
- `AGENT_APPROVAL_REQUIRED=true`。
- 每台 agent 使用稳定且唯一的 `AGENT_ID`。
- 每台 agent 保留自己的 `auth_private.pem`，只把 `auth_public.pem` 录入 `auth_code`。
- 设备换钥后按新设备重新审核，并由绑定用户更新 `auth_code`。
