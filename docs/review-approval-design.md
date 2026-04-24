# 用户与设备审核机制设计

更新时间：2026-04-24

## 目标

在不推翻当前架构的前提下，为系统补上两类“准入审核”：

- 用户审核：公开注册的账号不能再注册后立即使用系统，必须经过管理员审核。
- 设备审核：`localapp` 不能再仅凭共享 token 就进入正式在线设备列表，必须经过管理员审核。

本设计优先解决当前两个直接风险：

- 任意公网用户可公开注册后直接登录并使用控制台。
- 任意持有 `AGENT_SHARED_TOKEN` 的设备都可直接连接 `/ws/agent` 并出现在系统中。

## 当前现状

结合当前源码，现状如下：

### 1. 用户侧

- `ALLOW_PUBLIC_REGISTRATION=true` 时，`/api/auth/register` 会直接创建可用用户。
- 当前 `users` 表只有 `role` 和 `is_active`，没有“待审核 / 已拒绝 / 已通过”状态。
- 登录时只校验用户名密码和 `is_active`，不存在审核关卡。

### 2. 设备侧

- `/ws/agent` 当前只通过 URL 上的共享 token 做粗粒度校验。
- `agent.register` 一旦到达服务端，会直接进入内存态 `AgentRegistry` 并向浏览器广播。
- 当前没有持久化的“设备名册 / 审核状态 / 审核人 / 接入备注”。

### 3. 现有安全链路的边界

- 当前 `auth_code` 解决的是“某个用户是否能对某台设备加密下发安全命令”。
- 当前 `auth_code` 不是“设备是否允许接入平台”的审核机制。
- 因此需要新增一层平台级准入控制，而不是拿 `auth_code` 勉强兼任设备审核。

## 设计原则

### 1. 增量改造

- 不重写现有登录体系。
- 不重构现有 WebSocket 主链路。
- 不顺手引入细粒度 RBAC。
- 不把现有 `auth_code` 绑定语义改成别的东西。

### 2. 两层授权保持清晰

引入审核后，系统授权边界分为两层：

- 平台准入层：
  - 用户是否允许登录平台。
  - 设备是否允许接入平台。
- 业务使用层：
  - 当前登录用户是否持有目标 `agentId` 的唯一 `auth_code` 绑定。

这样可以避免把“账号可登录”和“可控制某设备”混在一起。

### 3. 先做可落地的一期

一期优先实现：

- 用户注册审核
- 设备接入审核
- 管理员审核入口
- 明确的状态流转
- 清晰的拒绝原因与日志

先不要求一期同时具备：

- 复杂审批流
- 多级审批
- 审批单评论区
- 完整审计报表中心
- 邀请码 / 安装码体系

这些能力如有需要，可在二期继续加。

## 总体方案

### 1. 用户审核

公开注册时不再直接生成“立即可用账号”，而是生成“待审核账号”。

管理员审核通过后：

- 账号才可登录。
- 账号才可使用当前已有的设备列表、命令、终端、文件读取等能力。

管理员拒绝后：

- 账号不可登录。
- 可保留申请记录，便于后续复核。

### 2. 设备审核

`localapp` 首次接入时不再直接进入正式在线设备列表。

服务端会先把它识别为“待审核设备申请”，只有管理员审核通过后：

- 该设备才允许进入正式在线注册表。
- 浏览器普通用户才能在设备列表中看到它。
- 服务端才会向其派发安全命令、终端会话和文件读取请求。

### 3. 设备身份绑定方式

设备审核不能只绑定 `agentId`，否则别人复用同名 `agentId` 就能冒充设备。

因此设备审核记录应至少绑定：

- `agentId`
- `localapp` 当前使用的 RSA 公钥指纹

推荐做法：

- `localapp` 在 `agent.register` 时附带本机控制链路公钥或其指纹。
- 服务端记录该公钥指纹，审批通过后将其视为该 `agentId` 的已批准设备身份。

这样当设备换了一套密钥、或有人试图复用同名 `agentId` 冒充时，服务端可以识别为“需要重新审核”，而不是直接放行。

### 4. `auth_code` 独占绑定

除平台设备审核外，一期还需要补一个更强的设备归属约束：

- 同一个 `agentId` 一旦已被某个用户绑定 `auth_code`
- 其他用户不能再为该 `agentId` 创建自己的 `auth_code` 绑定

也就是说：

- `auth_code` 不再是“每个用户都能各自绑定同一台设备”
- 而是“同一台设备在平台内只能归属于一个绑定用户”

这样可以避免：

- 多个用户同时宣称自己拥有同一设备的控制权
- 设备审核通过后，又被其他账号横向抢占绑定
- 后续审计时无法确定设备到底归谁负责

## 一期范围

一期建议严格控制为以下内容：

### 1. 用户审核

- 公开注册生成待审核账号
- 登录时识别待审核 / 已拒绝 / 已禁用
- 管理员审核通过 / 拒绝
- 管理员仍可直接创建已通过账号

### 2. 设备审核

- 首次接入生成待审核设备记录
- 已审核通过设备才可进入正式在线设备列表
- 已拒绝 / 已停用设备不可进入正式在线状态
- 已通过设备若公钥指纹变化，新建待审核设备记录并废弃旧记录

### 3. 管理后台

- 管理员可查看待审核用户
- 管理员可查看待审核设备
- 管理员可做通过 / 拒绝 / 停用 / 重新启用

### 4. 数据与日志

- MySQL 中保存当前审核状态与审核元信息
- 服务端日志保留审核动作日志

## 非目标

本设计一期不处理以下内容：

- 细粒度命令权限矩阵
- 按部门 / 组织架构自动审批
- 命令执行前人工二次审批
- 设备指令白名单审批
- 完整历史审计事件表
- 多租户隔离

## 用户审核设计

## 1. 用户状态模型

建议在保留现有 `is_active` 的基础上，新增 `approval_status`。

推荐状态：

- `pending`
- `approved`
- `rejected`

同时保留现有：

- `is_active`

状态含义：

- `pending`：
  - 已注册，但未审核。
  - 不允许登录。
- `approved` + `is_active = 1`：
  - 已审核通过。
  - 允许登录和使用系统。
- `approved` + `is_active = 0`：
  - 已审核通过，但当前被管理员停用。
  - 不允许登录。
- `rejected`：
  - 审核未通过。
  - 不允许登录。

这样能最大限度复用当前 `is_active` 语义，避免把“审核不通过”和“已通过但被停用”混成同一个状态。

## 2. 用户数据模型

建议在 `users` 表上新增：

- `approval_status` VARCHAR(32) NOT NULL DEFAULT 'approved'
- `registration_source` VARCHAR(32) NOT NULL DEFAULT 'admin'
- `application_note` VARCHAR(255) NOT NULL DEFAULT ''
- `approved_at` DATETIME NULL
- `approved_by_user_id` BIGINT UNSIGNED NULL
- `rejected_at` DATETIME NULL
- `rejected_by_user_id` BIGINT UNSIGNED NULL
- `review_comment` VARCHAR(255) NOT NULL DEFAULT ''

说明：

- 现有数据库中的默认管理员和已存在用户，迁移时统一回填为 `approved`。
- 管理员后台创建的用户，默认直接创建为 `approved`。
- 公开注册创建的用户，默认写入 `pending`。
- `application_note` 为可选字段，不强制填写。

## 3. 用户注册流程

### 公开注册

流程调整为：

1. 用户提交 `/api/auth/register`
2. 服务端创建用户记录，`approval_status = pending`
3. 返回“注册申请已提交，等待管理员审核”
4. 不自动登录
5. 管理员审核通过后，用户再自行登录

建议接口返回：

- HTTP `202`
- `message = 注册申请已提交，等待管理员审核`

补充：

- 公开注册页允许用户填写 `applicationNote`
- 该字段不强制，留空也允许提交

### 管理员创建用户

保留现有 `/api/users` 创建能力，但语义调整为：

- 管理员创建的用户默认 `approval_status = approved`
- 管理员可同时决定 `is_active`

这样管理员批量创建内部账号时，不必再额外走审核队列。

## 4. 用户登录行为

`/api/auth/login` 的鉴权结果建议细分为：

- 用户名或密码错误：
  - `401`
  - `用户名或密码错误`
- `approval_status = pending`：
  - `403`
  - `账号待管理员审核`
- `approval_status = rejected`：
  - `403`
  - `账号申请未通过，请联系管理员`
- `approval_status = approved` 且 `is_active = 0`：
  - `403`
  - `账号已停用`

这样前端可以明确给出状态，不再把所有失败都显示为“用户名或密码错误”。

## 5. 管理员操作

一期建议补充以下管理动作：

- 审核通过
- 审核拒绝
- 启用已通过用户
- 停用已通过用户
- 重置密码

建议规则：

- 待审核用户：
  - 可“通过”
  - 可“拒绝”
- 已拒绝用户：
  - 可“改为通过”
- 已通过用户：
  - 可“停用”
  - 可“重置密码”
- 停用用户：
  - 可“重新启用”

涉及会话处理时：

- 用户被拒绝、停用、重置密码时，应清理该用户现有全部 session

## 6. 用户前端改动

### 注册页

建议新增可选字段：

- `applicationNote`

可用于填写：

- 申请用途
- 所属团队
- 联系方式

如果想先压缩一期范围，也可以先不加这个字段，只保留最小审核流。

本次已确认：

- 公开注册页保留该字段
- 但不强制填写

### 管理员页

在现有 Profile / Admin 区域中新增：

- 待审核用户列表
- 已拒绝用户列表
- 已通过用户列表

每项至少展示：

- 用户名
- 显示名
- 角色
- 申请备注
- 创建时间
- 当前审核状态

并提供：

- 通过
- 拒绝
- 启用
- 停用

## 设备审核设计

## 1. 设备状态模型

设备侧建议采用“审核状态 + 启用状态”的思路，和用户保持一致。

推荐字段：

- `approval_status`
  - `pending`
  - `approved`
  - `rejected`
- `is_enabled`
  - `1`
  - `0`

补充一个运行时派生状态，不直接落库：

- `runtime_status`
  - `online`
  - `offline`

状态含义：

- `pending`：
  - 已提交接入申请，但未通过审核。
  - 不能进入正式在线设备列表。
- `approved` + `is_enabled = 1`：
  - 允许接入平台。
  - 若 websocket 在线，则出现在正式设备列表中。
- `approved` + `is_enabled = 0`：
  - 已批准过，但当前被停用。
  - 不允许接入平台。
- `rejected`：
  - 审核未通过。
  - 不允许接入平台。

## 2. 设备身份字段

建议新增持久化设备表，例如：

- `managed_agents`

建议字段：

- `id`
- `agent_id`
- `record_status`
- `label`
- `hostname`
- `platform`
- `arch`
- `auth_public_key` LONGTEXT
- `auth_public_key_fingerprint` CHAR(64)
- `approval_status`
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
- `created_at`
- `updated_at`

建议索引：

- `KEY idx_managed_agents_agent_id (agent_id)`
- `KEY idx_managed_agents_agent_record_status (agent_id, record_status)`
- `KEY idx_managed_agents_agent_review_status (agent_id, approval_status, is_enabled)`

说明：

- `record_status` 建议取值：
  - `current`
  - `superseded`
- 同一个 `agentId` 允许存在多条历史设备记录。
- 服务端在应用层保证同一时刻只有一条 `record_status = current` 的当前记录。
- 如果同一个 `agentId` 后续上报了不同公钥指纹，则创建一条新的 `pending + current` 记录，并把旧记录标记为 `superseded`。
- 这样可以满足“重新审核时废弃旧设备记录”，同时保留旧记录以便审计和回溯。

## 3. agent 注册载荷调整

当前 `agent.register` 建议新增字段：

- `authPublicKey`
- `authPublicKeyFingerprint`
- `applicationNote`

其中：

- `authPublicKey`：
  - 推荐由 `localapp` 基于本地私钥导出对应公钥，避免新增必须手填的公钥路径配置。
- `authPublicKeyFingerprint`：
  - 由 `shared/secure-command.mjs` 中同一套指纹算法生成。
- `applicationNote`：
  - 可选，用于填写设备用途、归属人、部署环境等。
  - 不强制填写，留空也允许接入申请。

## 4. 设备接入流程

推荐流程如下：

### 首次接入

1. `localapp` 通过 `AGENT_SHARED_TOKEN` 连到 `/ws/agent`
2. 发送 `agent.register`
3. 服务端读取 `agentId` 和设备公钥指纹
4. 若 `managed_agents` 中不存在记录：
   - 创建一条 `pending + current` 记录
   - 记录设备元信息和来源 IP
   - 不放入正式 `AgentRegistry`
   - 返回“待审核”提示后断开连接

### 已存在待审核记录

1. 服务端更新最后看到时间与设备元信息
2. 返回“待审核”提示
3. 不放入正式 `AgentRegistry`
4. 断开连接

### 已审核通过且启用

1. 若公钥指纹与已批准记录一致：
   - 允许进入 `AgentRegistry`
   - 允许后续心跳、命令、终端和文件读取链路
2. 若公钥指纹不一致：
   - 不直接放行
   - 创建一条新的 `pending + current` 设备记录
   - 将旧的已批准记录标记为 `superseded`
   - 写入“公钥指纹变化，待管理员复核”的审核备注
   - 断开连接

### 已拒绝或已停用

1. 服务端记录访问尝试
2. 不放入正式 `AgentRegistry`
3. 返回拒绝 / 停用原因
4. 断开连接

## 5. 设备审核动作

管理员对设备应至少具备以下操作：

- 审核通过
- 审核拒绝
- 停用设备
- 重新启用设备

建议规则：

- 待审核设备：
  - 可“通过”
  - 可“拒绝”
- 已拒绝设备：
  - 可“改为通过”
- 已通过设备：
  - 可“停用”
- 已停用设备：
  - 可“重新启用”

## 6. 公钥变化处理

设备公钥变化是一期必须明确处理的边界。

建议规则：

### 已批准设备上报了新公钥指纹

服务端不要直接接受，而应：

1. 新建一条新的设备记录，记录新的公钥和新指纹
2. 将新记录状态设为 `approval_status = pending`，`record_status = current`
3. 将旧记录标记为 `record_status = superseded`
4. 当前连接不进入正式在线状态
5. 管理员确认后再重新放行

原因：

- 这可能是正常重装或换钥
- 也可能是设备被仿冒

这也符合本次已确认策略：

- 换钥必须重新审核
- 旧设备记录需要废弃，而不是继续复用

### 对 `auth_code` 的影响

即使管理员重新批准了设备新公钥，也不代表设备的 `auth_code` 绑定自动更新。

因此需要明确：

- 设备审核通过，只代表平台允许该设备接入
- 当前唯一绑定用户若要继续安全下发命令，仍需确保自己保存的 `auth_code` 与新设备公钥一致
- 其他用户即使知道该设备新公钥，也不能直接为同一 `agentId` 新建绑定

一期先不自动改写设备现有绑定，避免越权替当前绑定用户更改设备信任关系。

### 对绑定转移的影响

既然同一设备只允许一个用户绑定，就必须预留“解绑或转移”机制。

建议规则：

- 普通用户：
  - 只能创建、修改、删除自己的绑定
  - 如果该设备已被其他用户占用，则创建时直接失败
- 管理员：
  - 应具备查看设备当前绑定归属的能力
  - 应具备强制解绑或转移绑定的能力

否则会出现一个问题：

- 用户 1 绑定了设备
- 用户 1 离职、停用或不再维护
- 用户 2 无法接手该设备

因此“设备唯一绑定”必须和“管理员可介入转移”一起设计。

## 7. 设备前端改动

建议在管理员区域新增“设备审核”板块。

一期可以继续沿用现有 Profile / Admin 区域，而不是新开复杂后台页面。

建议展示两块列表：

- 待审核设备
- 已管理设备

每项至少展示：

- `agentId`
- `label`
- `hostname`
- `platform`
- `arch`
- 公钥指纹
- 申请备注
- 首次看到时间
- 最后看到时间
- 当前审核状态

并提供：

- 审核通过
- 审核拒绝
- 停用
- 启用

## 服务端 API 设计

## 1. `/api/config`

建议新增返回：

- `registrationApprovalRequired`
- `agentApprovalRequired`

前端可据此决定：

- 注册页成功提示文案
- 管理员界面是否展示审核队列

## 2. 用户审核接口

建议新增：

- `POST /api/users/:id/approve`
- `POST /api/users/:id/reject`

保留现有：

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/reset-password`

说明：

- `PATCH /api/users/:id` 继续负责显示名、角色、启用状态维护
- 审核动作单独拆接口，避免混淆“审核”和“资料编辑”

## 3. 设备审核接口

建议新增：

- `GET /api/managed-agents`
- `POST /api/managed-agents/:id/approve`
- `POST /api/managed-agents/:id/reject`
- `PATCH /api/managed-agents/:id`

其中：

- `GET /api/managed-agents`
  - 仅管理员可访问
  - 支持按 `approvalStatus`、`isEnabled` 过滤
- `PATCH /api/managed-agents/:id`
  - 用于更新备注、启用状态

## 4. agent 侧控制消息

建议新增少量非敏感控制消息，供服务端在断开前返回给 agent：

- `agent.access.pending`
- `agent.access.rejected`
- `agent.access.disabled`
- `agent.access.reverify_required`

这些消息不承载敏感业务内容，不需要复用现有 secure envelope。

它们的主要价值是：

- 让 `localapp` 日志更可读
- 便于本地排查为什么设备没进入正式在线状态

## 与现有架构的关系

## 1. 与 `auth_code` 的关系

设备审核不是替代 `auth_code`，而是在其前面增加平台准入层。

调用链路变为：

1. 设备先通过平台设备审核
2. 用户先通过账号审核并成功登录
3. 该用户还必须是目标设备当前唯一的 `auth_code` 绑定用户
4. 服务端才可以继续现有的安全命令派发

## 2. 与 `AgentRegistry` 的关系

当前内存态 `AgentRegistry` 继续保留，但语义变为：

- 只保存“已审核通过且当前在线”的设备

新增的 `managed_agents` 表负责：

- 设备名册
- 审核状态
- 审核人
- 持久化设备元信息

这两层不要混用。

## 3. 与浏览器实时广播的关系

一期不建议为审核队列引入新的“管理员专属 WebSocket 广播”。

原因：

- 当前 `BrowserHub` 是全量广播模型
- 要做管理员定向广播，需要顺手重构 socket 权限模型

因此一期建议：

- 正式在线设备仍走现有 `agent.updated`
- 审核队列走管理员专用 REST 拉取

这样改动面更可控。

## 迁移与兼容策略

## 1. 用户数据迁移

迁移时建议：

- 所有现有用户默认回填为：
  - `approval_status = approved`
- 保持当前 `is_active` 不变

这样不会影响现有已在使用的账号。

## 2. 设备数据迁移

由于当前没有持久化设备名册，一期上线时需要明确策略。

推荐方案：

- 新增 `managed_agents` 表后，不自动把历史在线内存态设备回填成已批准
- 由管理员对现网设备重新逐台审核通过

原因：

- 当前系统没有可信的持久化设备身份基线
- 直接把历史内存态设备一键标记为“已批准”风险太高

如果担心切换成本，可在上线前提供一次性初始化脚本，但这属于上线工具，不属于审核机制主流程。

## 3. 接口兼容

为避免前端和脚本联调瞬间全部失效，建议按以下顺序落地：

1. 先加数据库字段和后端状态判断
2. 再加 `user_auth_codes` 的全局唯一约束和冲突校验
3. 再加管理员审核接口与管理员绑定转移能力
4. 再加前端审核 UI
5. 最后切换默认开关

这样开发联调阶段可先保留“兼容旧模式”的临时配置。

## 推荐配置项

建议新增以下环境变量：

- `REGISTRATION_APPROVAL_REQUIRED=true`
- `AGENT_APPROVAL_REQUIRED=true`

保持现有：

- `ALLOW_PUBLIC_REGISTRATION`
- `AGENT_SHARED_TOKEN`

推荐语义：

- `ALLOW_PUBLIC_REGISTRATION=false`
  - 不允许外部注册入口
- `ALLOW_PUBLIC_REGISTRATION=true` + `REGISTRATION_APPROVAL_REQUIRED=true`
  - 允许公开提交申请，但必须审核
- `AGENT_APPROVAL_REQUIRED=true`
  - 设备进入正式在线列表前必须审核

## 风险与边界

## 1. 审核机制并不等于网络层完全隔绝

即使加了设备审核，只要 `AGENT_SHARED_TOKEN` 泄露，未知设备仍可能尝试连到 `/ws/agent` 并提交接入申请。

一期能保证的是：

- 未审核设备不能成为正式在线设备
- 未审核设备不能被派发业务消息

一期不能完全保证的是：

- 未知设备连握手尝试本身绝不发生

如果要求做到“没有安装码就连申请都不能提”，则需要二期增加“设备安装码 / 邀请码”机制。

本次已确认：

- 一期不做安装码 / 邀请码
- 统一通过管理员审核机制控制准入

## 2. 审核不是细粒度权限控制

即使用户和设备都审核通过，也不代表：

- 该用户可以随意操作所有设备
- 该用户拥有命令级白名单权限

这些仍属于后续权限模型建设，不在本次范围。

## 3. 公钥变化会增加运维成本

设备重装、换钥后，需要：

- 管理员重新审核设备
- 服务端废弃旧设备记录并生成新的待审核记录
- 当前绑定用户重新确认或更新自己的 `auth_code`

这是安全性换来的显式成本，需要提前接受。

## 4. 设备唯一绑定会增加归属迁移成本

同一设备只能归属于一个用户后，后续会新增一类运维动作：

- 设备解绑
- 设备绑定转移

这意味着：

- 某设备已被用户 1 绑定时，用户 2 不能自行抢占
- 若确需转交，必须由当前绑定用户主动删除绑定，或由管理员介入转移

这是设备归属清晰化的代价，但也是所需的约束。

## 已确认项

以下内容已确认，可直接作为开发基线：

### 1. 用户注册备注

- 公开注册不强制填写备注
- 但允许用户填写 `applicationNote`

### 2. 设备审核主识别依据

- 设备审核必须依赖 `key_fingerprint`
- 平台主识别依据按 `agentId + auth_public_key_fingerprint` 处理

### 3. 安装码 / 邀请码

- 一期不做安装码 / 邀请码
- 统一通过管理员审核机制控制用户与设备准入

### 4. 设备换钥后的处理

- 已批准设备换钥后必须重新审核
- 旧设备记录需要废弃
- 新公钥对应新的待审核设备记录

### 5. 用户端 `auth_code` 录入限制

- 用户端录入界面不额外限制手工输入 `agentId`
- 但服务端必须保证同一设备只允许一个用户绑定 `auth_code`
- 如果该设备已被其他用户绑定，则新绑定请求必须拒绝
- 只有当前绑定用户，且设备已通过审核时，才能建立控制链路
- 一期继续允许手动录入任意 `agentId`

## 推荐结论

如果按“改动面可控、尽快落地”的原则推进，我建议采用：

- 用户侧：
  - 公开注册保留
  - 注册后进入 `pending`
  - 管理员审核通过后方可登录
- 设备侧：
  - 保留 `AGENT_SHARED_TOKEN`
  - 新增设备审核
  - 审核绑定 `agentId + 设备公钥指纹`
  - 未审核设备不进入正式在线设备列表
  - 换钥必须重新审核，并废弃旧设备记录
- `auth_code` 侧：
  - 同一设备全局只允许一个用户绑定
  - 其他用户不能重复绑定同一 `agentId`
  - 管理员需要具备解绑或转移设备绑定的能力
- 前端：
  - 在现有管理员区域增量补“用户审核”和“设备审核”
- 一期不做：
  - 安装码
  - 复杂审计历史中心
  - 管理员专属 WebSocket 广播

这套方案和当前代码结构最贴近，开发风险也最低。
