# CLAUDE.md

## 文件定位

这是一份给 Claude / Codex 使用的仓库入口文档。它只负责说明项目是什么、核心链路如何工作、代码分支从哪里读起，以及哪些专题文档承载详细内容。

如果需要实现细节、接口时序、部署步骤或设计背景，不要把长说明继续堆到本文件里，优先更新并引用 `docs/` 下的专题文档。

## 项目一句话

这是一个基于 npm workspaces 的远程控制系统：目标机器上的 `localapp` 主动外连 `webserver/server`，外网 Web 控制台通过安全封装下发命令、交互式终端和远程文件读取请求，执行结果再实时回传给浏览器。

## 事实来源优先级

1. 运行时行为以源码为准：`localapp/src`、`webserver/server/src`、`webserver/client/src`、`shared/secure-command.mjs`
2. 数据库结构以 `db/init.sql` 和服务端启动时的 schema 补齐逻辑为准。
3. 环境变量以 `webserver/server/.env.example`、`localapp/.env.example` 为准。
4. `docs/` 是专题说明和设计背景；如果文档与代码冲突，先相信代码，再同步文档。

## 当前组件地图

| 组件 | 定位 | 主要入口 |
| --- | --- | --- |
| `localapp` | 部署在目标机器上的 Node.js agent，负责主动连接、验签解密、一次性命令、PTY 会话、本地调试和远程文本文件读取。 | `localapp/src/index.js`、`localapp/src/agent-client.js`、`localapp/src/runtime/*` |
| `webserver/server` | Express + ws 服务端，负责登录会话、用户/设备审核、`auth_code`、安全消息封装、WebSocket 转发和摘要持久化。 | `webserver/server/src/index.js`、`webserver/server/src/auth/*`、`webserver/server/src/agents/*`、`webserver/server/src/state/*` |
| `webserver/client` | Vue 3 + Element Plus 控制台，覆盖首页、终端、对话、任务、我的、授权与管理入口。 | `webserver/client/src/router/index.js`、`webserver/client/src/stores/console.js`、`webserver/client/src/pages/*`、`webserver/client/src/components/*` |
| `shared` | 安全命令链路的共享实现，server 和 agent 都应复用这里，不要复制加解密逻辑。 | `shared/secure-command.mjs` |
| `localapp2` | 实验性 Electron Windows 客户端骨架，面向托盘、图形配置和密钥管理；当前不是默认生产 agent。 | `localapp2/*` |

## 核心链路概览

1. 浏览器登录 Web 控制台，服务端用 `user_sessions` 和 HTTP-only cookie 维护会话。
2. 公开注册、用户审核、设备审核由服务端和前端管理入口处理；通过审核的设备才进入正式在线设备列表。
3. 用户为已审核设备绑定唯一 `auth_code`，即目标 agent 的 RSA 公钥 PEM；服务端会规范化 PEM 并计算指纹。
4. 浏览器发起一次性命令、终端会话或文件读取请求后，服务端通过 `shared/secure-command.mjs` 生成安全 envelope。
5. `localapp` 收到 `*.secure` 消息后验签、解密，并校验 `agentId`、`expiresAt`、`nonce`，通过后才执行。
6. 执行状态、终端输出、文件读取结果通过 WebSocket 回到服务端，再实时广播给浏览器。

## 必须守住的边界

- 不要把明文 `command.execute` 重新作为默认派发路径。
- 不要绕开 `shared/secure-command.mjs` 自己拼加密、签名、验签或解密逻辑。
- 不要在日志、接口响应或前端 UI 中暴露私钥内容，也不要输出完整密钥 PEM。
- 修改 `auth_code` 时继续保持 RSA PEM 规范化、指纹计算、设备唯一绑定和审核约束。
- 修改 agent 校验时不要删除 `agentId`、`expiresAt`、`nonce` 检查。
- `CommandStore`、在线设备和活动终端输出仍有内存态边界；不要误认为所有实时状态都已完整落库。

## 专题文档索引

| 主题 | 引用文档 | 说明 |
| --- | --- | --- |
| 当前整体架构、通信协议、状态边界 | [docs/architecture.md](docs/architecture.md) | 先读这份，了解当前已落地能力和核心时序。 |
| 部署、启动、联调、生产运维 | [docs/deployment-and-usage.md](docs/deployment-and-usage.md) | 覆盖测试环境、生产 webserver、Windows/Linux agent 部署。 |
| `auth_code`、RSA 加密、服务端签名 | [docs/auth-code-rsa-design.md](docs/auth-code-rsa-design.md) | 安全 envelope、密钥职责、验签解密和日志边界。 |
| 一次性命令、PTY 会话、本地调试、文件读取 | [docs/localapp-external-terminal-design.md](docs/localapp-external-terminal-design.md) | `localapp` 双通道执行模型和 profile 驱动会话。 |
| 用户审核、设备审核、唯一绑定 | [docs/review-approval-design.md](docs/review-approval-design.md) | 准入审核、设备公钥指纹、绑定归属和管理接口设计。 |
| Electron agent 方向 | [docs/localapp-electron-design.md](docs/localapp-electron-design.md) | `localapp2` 当前状态与后续演进边界。 |
| 对话式交互入口 | [docs/chat-interaction-design.md](docs/chat-interaction-design.md) | 聊天页如何复用安全命令、终端会话和文件预览。 |
| UI 优化待办 | [docs/ui-optimization-todolist.md](docs/ui-optimization-todolist.md) | 前端界面优化批次、验收点和剩余事项。 |
| 对外项目对比 | [docs/remote-client-vs-openclaw.md](docs/remote-client-vs-openclaw.md)、[docs/remote-client-vs-cc-connect.md](docs/remote-client-vs-cc-connect.md) | 产品定位、安全边界和适用场景对比。 |
| 开发协作、验证、提交规范 | [docs/development-guidelines.md](docs/development-guidelines.md) | 给 Claude / Codex 的具体改码规则和最小验证要求。 |

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

## 读码建议

- 涉及安全链路时，同时看 `shared`、`webserver/server/src/security`、`localapp/src/security`。
- 涉及用户、会话、审核或 `auth_code` 时，同时看 `db/init.sql`、`webserver/server/src/auth`、`webserver/server/src/agents`。
- 涉及前端页面时，先确认 `webserver/client/src/stores/console.js`、路由、组件和 WebSocket 事件名，再改 UI。
- 小修优先沿用现有架构和文件组织；除非任务明确要求，不要顺手大拆 `webserver/server/src/index.js` 或前端主状态流。
