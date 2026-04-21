# Auth Code + RSA 双向校验设计

更新时间：2026-04-21

## 目标

在 `webserver -> localapp` 的控制链路上同时解决两件事：

- 只有目标 `localapp` 能看到命令/会话/文件读取请求的明文
- `localapp` 能确认消息确实来自受信任的 `webserver`

当前这套方案已经不是纯设计，命令、安全终端会话和远程文件读取都已经复用同一套安全 envelope 落地。

## 核心设计

## 1. `auth_code` 独立存表

`auth_code` 不再放在 `users` 表，而是独立放到：

- `user_auth_codes`

当前表职责：

- `user_id`：归属哪个控制台用户
- `agent_id`：对应哪台 `localapp`
- `auth_code`：保存目标 agent 的 RSA 公钥 PEM
- `remark`：用户备注

当前服务端会在写入时：

- 规范化 PEM
- 校验是否为 RSA 公钥
- 计算 SHA-256 指纹

这样每个用户都可以对不同 `agentId` 维护独立公钥绑定。

## 2. 两套密钥并行使用

### 第一套：`localapp` 解密密钥

用途：

- `webserver` 用 `auth_code` 公钥加密业务载荷
- `localapp` 用本地私钥解密

存放方式：

- 公钥保存到 `user_auth_codes.auth_code`
- 私钥只保存在目标 agent 本地

### 第二套：`webserver` 签名密钥

用途：

- `webserver` 用私钥对安全 envelope 签名
- `localapp` 用公钥验签

存放方式：

- 私钥保存在 `webserver/server/keys`
- 公钥分发到 `localapp/keys`

## 3. 为什么不是只用一套密钥

如果只有 `localapp` 自己的公钥：

- 任何拿到这个公钥的人都可以构造密文
- `localapp` 只能证明“我能解开”，不能证明“消息来自官方服务端”

因此当前实现必须同时具备：

- 加密链路：保护内容
- 签名链路：保护来源

## 当前已落地的安全消息范围

当前共享安全实现位于：

- `shared/secure-command.mjs`

当前已覆盖的消息类型：

- `command.execute.secure`
- `terminal.session.create.secure`
- `terminal.session.input.secure`
- `terminal.session.resize.secure`
- `terminal.session.terminate.secure`
- `file.read.secure`

这意味着当前安全链路已经不只保护“一次性命令”，也保护：

- 交互式终端会话创建
- 会话输入
- 终端 resize
- 会话终止
- 远程文件读取

## 密钥生成工具

当前仓库已提供通用 RSA 密钥生成工具：

- [scripts/generate-rsa-keypair.js](/c:/project/remote-client/scripts/generate-rsa-keypair.js)

根目录可直接执行：

```bash
npm run auth:keygen:localapp
npm run auth:keygen:webserver
npm run auth:keygen:all
```

### `auth:keygen:localapp`

默认生成：

- `localapp/keys/auth_private.pem`
- `localapp/keys/auth_public.pem`

### `auth:keygen:webserver`

默认生成：

- `webserver/server/keys/webserver_sign_private.pem`
- `webserver/server/keys/webserver_sign_public.pem`
- `localapp/keys/webserver_sign_public.pem`

### 当前工具行为

- 默认拒绝覆盖已有文件
- 支持 `--force`
- 支持通过环境变量给私钥加口令
- 会输出路径和公钥指纹

## 环境变量

## `localapp/.env`

当前关键项：

```env
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
AUTH_PRIVATE_KEY_PASSPHRASE=
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
```

## `webserver/server/.env`

当前关键项：

```env
WEBSERVER_SIGN_PRIVATE_KEY_PATH=./keys/webserver_sign_private.pem
WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE=
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
```

## 当前 web 端 `auth_code` 能力

`webserver/client` 当前已经有完整的 `auth_code` 管理界面，支持：

- 列表
- 新增
- 编辑
- 删除
- 指纹展示

典型流程：

1. 在目标机生成或读取 `auth_public.pem`
2. 登录 Web 控制台
3. 为对应 `agentId` 创建或更新 `auth_code`
4. 后续该用户对该设备的安全命令、终端会话、文件读取都使用这条公钥绑定

## 当前命令/终端/文件读取的安全封装流程

1. 浏览器提交业务请求
2. 服务端按当前用户和目标 `agentId` 查找 `user_auth_codes`
3. 服务端用该 `auth_code` 创建 RSA 公钥对象
4. 服务端随机生成一次性 AES 会话密钥
5. 服务端用 AES-256-GCM 加密业务明文
6. 服务端用 `auth_code` 公钥加密 AES 会话密钥
7. 服务端使用自己的签名私钥做 `RSA-SHA256` 签名
8. 服务端向 `localapp` 发送安全 envelope
9. `localapp` 先验签，再解密，再做业务字段校验
10. 校验通过后才真正执行

## 当前安全 envelope 结构

当前实现是：

- WebSocket 外层 `type`
- `payload` 中保存加密数据和签名
- `meta` 中保存指纹和辅助信息

以 `command.execute.secure` 为例，当前 envelope 由这些部分组成：

- `type`
- `payload.messageType`
- `payload.requestId`
- `payload.agentId`
- `payload.operatorUserId`
- `payload.authCodeId`
- `payload.algorithm`
- `payload.encryptedKey`
- `payload.iv`
- `payload.tag`
- `payload.ciphertext`
- `payload.signature`
- `sentAt`
- `meta.authCodeFingerprint`
- `meta.webserverSignFingerprint`

终端会话和文件读取会在 `meta` 中额外带上：

- `sessionId`
- `profile`
- `filePath`

## `localapp` 当前执行前校验

当前 `localapp/src/security/secure-command-service.js` 会在解密后做这些校验：

1. 消息类型必须匹配
2. `payload.messageType` 必须匹配
3. 签名必须有效
4. 使用本地私钥成功解密
5. `agentId` 必须等于本地配置
6. `expiresAt` 必须有效且未过期
7. `nonce` 必须存在且未重复使用
8. 调用方要求的字段必须齐全

如果任一环节失败：

- `localapp` 不执行
- 记录结构化日志
- 一次性命令会回传 `command.finished` 失败态
- 终端/文件读取会回传对应错误事件

## 当前日志约束

### 服务端

当前日志会记录：

- 当前用户
- 目标 `agentId`
- `authCodeId`
- `authCodeFingerprint`
- 安全封装或派发失败原因

### agent

当前日志会记录：

- 验签结果
- 解密结果
- 本地公钥/服务端签名公钥指纹
- 失败原因

两端都遵守：

- 不记录私钥明文
- 不打印完整私钥 PEM

## 当前状态

### 已完成

- `user_auth_codes` 数据模型与 CRUD
- RSA 密钥生成工具
- `shared/secure-command.mjs`
- `webserver` 侧安全 envelope 生成
- `localapp` 侧验签、解密、`agentId` / `expiresAt` / `nonce` 校验
- 一次性命令安全下发
- 交互式终端会话安全下发
- 远程文件读取安全下发

### 当前边界

- 这套安全链路主要覆盖 `server -> agent`
- `agent -> server` 结果消息仍是现有业务回传模型
- 当前没有把私钥托管、轮换和吊销做成独立运维系统
- 当前权限模型仍是 `admin / operator / viewer`

## 结论

当前项目已经从“Auth Code + RSA 设计方案”进入“Auth Code + RSA 已落地实现”阶段。

与最初设计相比，当前实现的特点是：

- 不只保护一次性命令
- 已统一扩展到终端会话与文件读取
- 前后端与 agent 三端都已真正接入
- 共享安全逻辑集中在 `shared/secure-command.mjs`
