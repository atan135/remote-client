# Remote Client

一个基于 npm workspaces 的远程控制系统：目标机器上的 `localapp` 主动外连 `webserver/server`，外网 Web 控制台通过安全封装下发一次性命令、交互式终端会话和远程文件读取请求，执行结果实时回传给浏览器。

当前仓库已经不是“只有设计文档”的状态。安全命令链路、用户/设备审核、`auth_code` 绑定、终端会话、远程文件读取和 Vue 控制台都已经落地。

## 组件

| 组件 | 说明 |
| --- | --- |
| `localapp` | 部署在目标机器上的 Node.js agent，负责主动连接、断线重连、验签解密、执行命令、PTY 会话、本地调试和远程文本文件读取。 |
| `webserver/server` | Node.js + Express + ws 服务端，负责登录会话、用户/设备审核、`auth_code`、安全消息封装、WebSocket 转发和摘要持久化。 |
| `webserver/client` | Vue 3 + Element Plus 控制台，提供首页、终端、对话、任务、我的、授权和管理入口。 |
| `shared` | 安全 envelope 的共享实现，server 和 agent 共用 `shared/secure-command.mjs`。 |
| `localapp2` | 实验性 Electron Windows 客户端，已接入主要 agent runtime，但当前仍不是默认生产 agent。 |

## 核心能力

- 目标机 agent 主动外连，无需把内网机器暴露为公网入口。
- 浏览器会话基于 HTTP-only cookie 和 `user_sessions`。
- 支持公开注册、用户审核、设备审核、用户启停和管理员重置密码。
- `auth_code` 按 `agentId` 全局唯一绑定，服务端规范化 RSA 公钥 PEM 并计算 SHA-256 指纹。
- 下行控制消息使用 `*.secure` envelope，包含 RSA 公钥加密、AES-256-GCM 加密、服务端 RSA-SHA256 签名、`agentId` / `expiresAt` / `nonce` 校验。
- 支持一次性命令、交互式 PTY 终端会话、远程文本文件预览。
- Web 控制台支持普通命令对话和 Codex / AI Agent 终端会话模式。

## 环境准备

建议运行环境：

- Node.js 20 及以上
- npm 10 及以上
- MySQL 8.x

安装依赖：

```bash
npm install
```

初始化数据库：

```bash
mysql -uroot -p -h 127.0.0.1 < db/init.sql
```

生成 RSA 密钥：

```bash
npm run auth:keygen:all
```

默认数据库和账号：

- 数据库：`remote_client`
- 默认管理员：`admin`
- 默认密码：`ChangeMe123!`

## 快速启动

复制环境变量模板：

```bash
cp webserver/server/.env.example webserver/server/.env
cp localapp/.env.example localapp/.env
```

Windows PowerShell：

```powershell
Copy-Item webserver/server/.env.example webserver/server/.env
Copy-Item localapp/.env.example localapp/.env
```

至少确认以下配置：

- `webserver/server/.env`
  - `MYSQL_URL`
  - `AGENT_SHARED_TOKEN`
  - `REGISTRATION_APPROVAL_REQUIRED`
  - `AGENT_APPROVAL_REQUIRED`
  - `WEBSERVER_SIGN_PRIVATE_KEY_PATH`
  - `WEBSERVER_SIGN_PUBLIC_KEY_PATH`
- `localapp/.env`
  - `SERVER_WS_URL`
  - `AGENT_ID`
  - `AGENT_LABEL`
  - `AGENT_SHARED_TOKEN`
  - `AUTH_PRIVATE_KEY_PATH`
  - `WEBSERVER_SIGN_PUBLIC_KEY_PATH`

本地联调建议设置：

```env
AGENT_SHARED_TOKEN=test-shared-token
AGENT_APPROVAL_REQUIRED=true
```

并确保 `localapp/.env` 中的 `AGENT_SHARED_TOKEN` 与服务端一致。

分别启动三个进程：

```bash
npm run dev:server
npm run dev:client
npm run dev:agent
```

默认访问地址：

```text
http://127.0.0.1:5173
```

默认端口：

- 服务端 HTTP：`3100`
- agent WebSocket：`ws://localhost:3100/ws/agent`
- 前端开发服务器：`5173`

## 首次联调

1. 浏览器访问 `http://127.0.0.1:5173`。
2. 使用 `admin / ChangeMe123!` 登录。
3. 如果开启了 `AGENT_APPROVAL_REQUIRED=true`，先在“我的 -> 设备审核”中通过目标设备。
4. 打开 `localapp/keys/auth_public.pem`。
5. 在“我的 -> 公钥绑定”中为目标 `agentId` 录入完整公钥 PEM。
6. 到“终端”页或“对话”页发送 `hostname`、`whoami`、`ipconfig /all`、`uname -a` 等命令验证链路。

注意：当前服务端创建 / 更新 `auth_code` 时会要求目标设备在 `managed_agents` 中处于已审核且启用状态。实际联调建议开启设备审核并完成审批，避免绑定时出现“设备未通过审核，暂不允许绑定 auth_code”。

## 常用命令

```bash
npm run dev:server
npm run dev:client
npm run dev:agent
npm run build:client
npm run auth:keygen:localapp
npm run auth:keygen:webserver
npm run auth:keygen:all
```

`localapp2` 相关命令：

```bash
npm run dev:agent2
npm run build:agent2
npm run sync:agent2
npm run check:agent2-sync
```

## 文档入口

- [CLAUDE.md](CLAUDE.md)：给 Claude / Codex 使用的仓库入口文档。
- [docs/architecture.md](docs/architecture.md)：当前整体架构、通信协议和状态边界。
- [docs/deployment-and-usage.md](docs/deployment-and-usage.md)：部署、启动、联调和生产运维说明。
- [docs/auth-code-rsa-design.md](docs/auth-code-rsa-design.md)：`auth_code`、RSA 加密、服务端签名和安全 envelope。
- [docs/review-approval-design.md](docs/review-approval-design.md)：用户审核、设备审核和设备唯一绑定。
- [docs/localapp-external-terminal-design.md](docs/localapp-external-terminal-design.md)：一次性命令、PTY 会话、本地调试和远程文件读取。
- [docs/chat-interaction-design.md](docs/chat-interaction-design.md)：对话页普通命令模式和 Codex / AI Agent 会话模式。
- [docs/localapp-electron-design.md](docs/localapp-electron-design.md)：`localapp2` Electron 客户端当前状态。
- [docs/development-guidelines.md](docs/development-guidelines.md)：开发协作、验证和提交约定。

## 当前边界

- 当前角色模型仍是 `admin / operator / viewer`，没有更细粒度的 RBAC。
- 在线设备、活动命令和终端原始输出仍包含内存态边界。
- 命令与终端会话主要持久化摘要，不默认长期保存完整原始流。
- `localapp2` 已接入主要运行时，但仍是实验性 Electron 客户端，不建议替代默认生产 `localapp`。
