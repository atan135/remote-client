# CLAUDE.md

## 项目概览

这是一个基于 npm workspaces 的三端仓库，用于实现“内网 agent 主动外连 + 外网 Web 控制台下发命令 + 结果实时回传”的远程控制链路。

当前仓库包含 3 个主要模块：

- `localapp`：部署在目标机器上的 Node.js agent，主动连接服务端，验签/解密安全命令，串行执行命令并回传结果。
- `webserver/server`：Node.js + Express + ws 服务端，负责登录鉴权、会话管理、`auth_code` 管理、命令安全封装、agent/browser WebSocket。
- `webserver/client`：Vue 3 + Element Plus 控制台，负责登录、设备查看、`auth_code` 绑定、命令下发、链路查看、用户管理。

这个仓库已经不是“只有设计文档”的状态。安全命令链路、`auth_code` CRUD、会话登录和前端控制台都已经落地。

## 事实来源

- 运行时行为以源码为准：`localapp/src`、`webserver/server/src`、`webserver/client/src`
- 数据库基线以 `db/init.sql` 为准
- `docs/` 下文档是补充说明，不一定都代表当前实现
- 如果文档与代码冲突，优先相信代码

特别注意：

- `docs/localapp-electron-design.md` 是改造方案，不是当前已实现形态
- `docs/auth-code-rsa-design.md` 大体描述了当前安全链路，但细节仍应以源码为准

## 仓库结构

```text
.
├─ db/
│  └─ init.sql
├─ docs/
├─ localapp/
│  ├─ .env.example
│  ├─ src/
│  │  ├─ index.js
│  │  ├─ config.js
│  │  ├─ agent-client.js
│  │  ├─ command-runner.js
│  │  ├─ logger.js
│  │  └─ security/secure-command-service.js
├─ shared/
│  └─ secure-command.mjs
├─ scripts/
│  └─ generate-rsa-keypair.js
├─ webserver/
│  ├─ client/
│  │  ├─ package.json
│  │  ├─ vite.config.js
│  │  └─ src/
│  └─ server/
│     ├─ .env.example
│     └─ src/
└─ package.json
```

## 常用命令

在仓库根目录执行：

```bash
npm install
npm run dev:server
npm run dev:client
npm run dev:agent
npm run build:client
```

初始化数据库：

```bash
mysql -uroot -p -h 127.0.0.1 < db/init.sql
```

生成 RSA 密钥：

```bash
npm run auth:keygen:localapp
npm run auth:keygen:webserver
npm run auth:keygen:all
```

## 默认端口与配置

- 服务端 HTTP：`3100`
- agent 默认连接：`ws://localhost:3100/ws/agent`
- 前端开发服务器：`5173`
- 前端开发代理：
  - `/api` -> `http://localhost:3100`
  - `/ws/browser` -> `ws://localhost:3100`

关键环境变量文件：

- `webserver/server/.env.example`
- `localapp/.env.example`

默认数据库：

- 库名：`remote_client`
- 字符集：`utf8mb4`

默认管理员账号：

- 用户名：`admin`
- 密码：`ChangeMe123!`

## 当前已实现的核心链路

### 1. 登录与会话

- 浏览器通过 `/api/auth/login` 登录
- 服务端使用 `user_sessions` 表保存会话
- 会话通过 HTTP-only cookie 维持
- `/api/auth/session` 用于恢复登录状态
- 支持公开注册、退出登录、修改密码
- 管理员可创建用户、修改角色/启停、重置密码

### 2. `auth_code` 绑定

- 每个用户可以为不同 `agentId` 维护 RSA 公钥绑定
- 数据表为 `user_auth_codes`
- 前端已支持新增、编辑、删除绑定
- 服务端会规范化 PEM 并计算 SHA-256 指纹

### 3. 安全命令派发

实际实现不是明文 `command.execute`，而是安全版本：

- 浏览器提交命令到 `/api/commands`
- 服务端必须先找到当前用户在目标 `agentId` 上的 `auth_code`
- 服务端使用 `shared/secure-command.mjs` 进行：
  - RSA 公钥加密 AES 会话密钥
  - AES-256-GCM 加密命令体
  - 使用 webserver 私钥做 `RSA-SHA256` 签名
- 最终下发消息类型为 `command.execute.secure`

### 4. agent 执行前校验

`localapp` 收到命令后会：

- 校验消息类型必须是 `command.execute.secure`
- 使用 `WEBSERVER_SIGN_PUBLIC_KEY_PATH` 验签
- 使用 `AUTH_PRIVATE_KEY_PATH` 解密
- 校验 `agentId`
- 校验 `expiresAt`
- 校验 `nonce` 防重放
- 校验通过后才进入本地执行

当前 agent 会明确拒绝明文 `command.execute`。

## WebSocket 协议

### agent -> server

- `agent.register`
- `agent.heartbeat`
- `command.started`
- `command.finished`

### server -> agent

- `command.execute.secure`

### server -> browser

- `snapshot`
- `agent.updated`
- `command.updated`

## 模块说明

### `localapp`

技术栈：

- Node.js ESM
- `ws`
- `log4js`
- `iconv-lite`

行为特征：

- 主动连接服务端并自动重连
- 启动后发送 `agent.register`
- 周期性发送心跳
- 使用单队列串行执行命令，避免并发互相影响
- 网络断开时会缓存待发送状态消息到内存 outbox
- Windows 下命令输出默认按 `cp936` 解码
- 有一个很小的兼容层：Windows 上把 `which nodejs` 转成 `where.exe node`

关键文件：

- `localapp/src/index.js`
- `localapp/src/agent-client.js`
- `localapp/src/command-runner.js`
- `localapp/src/security/secure-command-service.js`
- `localapp/src/logger.js`

### `webserver/server`

技术栈：

- Node.js ESM
- Express
- `ws`
- `mysql2/promise`
- `log4js`

行为特征：

- 主要 REST API 和 WebSocket 逻辑集中在 `src/index.js`
- 用户、会话、`auth_code` 走 MySQL
- 在线 agent 和命令历史在内存里管理
- 服务启动时会尝试自动创建 `user_auth_codes` 表

关键文件：

- `webserver/server/src/index.js`
- `webserver/server/src/auth/*.js`
- `webserver/server/src/security/secure-command-service.js`
- `webserver/server/src/state/agent-registry.js`
- `webserver/server/src/state/command-store.js`
- `webserver/server/src/logger.js`

### `webserver/client`

技术栈：

- Vue 3
- Element Plus
- Vite

行为特征：

- 当前没有 router / pinia，主要逻辑集中在单个 `App.vue`
- 页面已覆盖登录、总览、命令输入、链路查看、`auth_code` 管理、账号安全、用户管理
- 用户态实时更新依赖 `/ws/browser`
- UI 文案以中文为主

关键文件：

- `webserver/client/src/App.vue`
- `webserver/client/src/main.js`
- `webserver/client/src/styles.css`
- `webserver/client/vite.config.js`

### `shared`

`shared/secure-command.mjs` 是安全链路的单一事实来源，包含：

- RSA 公钥 PEM 规范化
- 公钥指纹计算
- RSA 私钥/公钥对象创建
- 混合加密
- 安全消息签名与验签

如果改动安全链路，优先复用这里，不要在 server 和 agent 两边各自复制一套加解密逻辑。

## 数据与状态边界

持久化到 MySQL 的内容：

- 用户
- 会话
- `auth_code` 绑定

仅保存在内存的内容：

- 在线 agent 注册表
- 命令历史与实时状态

这意味着：

- 服务端重启后，命令历史会丢失
- 设备在线状态会重建
- 不要误以为 `CommandStore` 是数据库实现

## 日志约定

服务端日志目录默认在：

- `webserver/server/logs`

agent 日志目录默认在：

- `localapp/logs`

日志通过 `log4js` 输出，并统一使用 `logEvent(logger, level, event, payload)` 包装 JSON 事件体。

修改日志时请遵守：

- 保持结构化字段，便于检索
- 不要记录私钥明文
- 不要把完整密钥 PEM 打进日志
- 命令输出可能包含敏感信息，新增日志时要控制暴露面

## 编码与实现约定

- 全仓库目前使用 JavaScript，不是 TypeScript
- Node 侧模块使用 ESM
- 用户可见错误信息和表单提示优先保持中文风格
- 当前前端已经建立了 Element Plus + 自定义 CSS 的视觉风格，修改时尽量延续，不要整页重写成另一套脚手架式 UI
- 后端目前偏单文件入口组织，尤其 `webserver/server/src/index.js` 较大；除非任务明显扩大，否则优先做增量修改

## Git 提交规范

- 提交按**功能模块**拆分：一个 commit 只解决一类问题，避免把协议、服务实现、测试工具、文档更新混在同一个提交里。
- 提交标题格式统一为：`<type>: <简短主题>`
- `type` 推荐使用：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`
- 提交标题中的“主题”统一使用中文，不使用英文短语或中英混写主题。
- 标题要直接说明“改了什么”，优先写具体模块或能力，不写空泛描述。
- 提交正文与标题之间保留一个空行。
- 提交正文至少说明两点：
- 这次一起改了哪些关键项
- 为什么要这样改，解决了什么问题，或避免了什么联调/维护风险
- 如果改动涉及端口、配置、协议、脚本或跨服务联动，正文里要明确写出受影响的服务名、关键配置项或关键文件。

示例：

```text
chore: 统一 game-proxy 默认端口配置

将 game-proxy 默认监听端口和 auth-http 默认下发的 GAME_PROXY_PORT 一并调整为 4000，并同步更新 port.txt 与示例环境变量，避免与 game-server 端口段混用，减少联调时连错入口的问题。
```

## 修改安全链路时的硬性要求

1. 不要把明文 `command.execute` 重新作为默认派发路径。
2. 不要绕开 `shared/secure-command.mjs` 自己拼加密/签名逻辑。
3. 不要在日志、接口响应或前端 UI 中暴露私钥内容。
4. 修改 `auth_code` 处理时，继续保持 RSA PEM 规范化与指纹计算。
5. 修改 agent 侧校验时，不要删除 `agentId`、`expiresAt`、`nonce` 检查。

## 启动与联调建议

典型联调顺序：

1. `npm install`
2. 初始化 MySQL：`db/init.sql`
3. 生成密钥：`npm run auth:keygen:all`
4. 启动服务端：`npm run dev:server`
5. 启动前端：`npm run dev:client`
6. 启动 agent：`npm run dev:agent`
7. 浏览器登录 `admin / ChangeMe123!`
8. 将 `localapp/keys/auth_public.pem` 的内容录入前端 `auth_code` 绑定
9. 选择设备并发送诸如 `hostname`、`whoami`、`ipconfig /all` 之类的命令做链路验证

## 验证建议

这个仓库当前没有成体系的自动化测试脚本。做改动后，至少执行与任务相关的最小验证：

- 前端改动：`npm run build:client`
- 服务端改动：登录、会话、API、WebSocket 手动冒烟
- agent / 安全链路改动：实际跑通一次“绑定公钥 -> 发命令 -> agent 验签解密 -> 返回结果”
- 数据库改动：同时检查 `db/init.sql` 与服务启动时的表兼容性

## 已知实现边界

- 命令历史是内存态，服务端重启即丢失
- `localapp` 当前是 CLI/后台 Node 进程，不是 Electron 应用
- 前端目前主要逻辑集中在 `App.vue`，后续重构要注意不要在单次任务里顺手大拆
- 当前没有 RBAC 细粒度权限模型，只有 `admin / operator / viewer`

## 给 Claude/Codex 的工作建议

- 先读相关源码，再决定是否参考 `docs/`
- 涉及安全链路时，把 `shared`、`server`、`localapp` 三处一起看
- 涉及用户/会话/`auth_code` 时，同时检查 `db/init.sql` 和 `webserver/server/src/auth`
- 涉及前端页面时，先确认接口和 WebSocket 事件名，不要只改 UI 不改数据流
- 如果只是修一个小问题，优先保持当前架构，不要顺手引入新的框架层
