# 功能架构说明

更新时间：2026-04-21

## 目标

实现一个“内网 agent 主动外连 + 外网控制台下发安全命令/终端会话 + 结果实时回传”的远程控制系统。

当前仓库已经不是纯设计态，以下内容以现有源码和数据库脚本为准。

## 当前组件

### 1. `localapp`

部署在目标机器上的 Node.js agent，负责：

- 主动连接 `webserver/server`
- 验签、解密、执行安全命令
- 维护交互式 PTY 终端会话
- 回传命令结果、终端输出和文件读取结果
- 可选开启仅限本机访问的本地调试接口

### 2. `webserver/server`

Node.js + Express + ws 服务端，负责：

- 登录鉴权与浏览器会话
- `auth_code` 绑定管理
- 安全消息封装与派发
- agent/browser WebSocket
- 命令与终端会话摘要持久化

### 3. `webserver/client`

Vue 3 控制台，负责：

- 登录与账号管理
- 设备选择与状态展示
- 一次性命令下发
- 交互式终端会话创建、输入、终止、删除
- 远程文本文件预览
- `auth_code` 管理

### 4. `localapp2`

当前仓库中还存在一个 Electron Windows 客户端骨架：

- 已落地托盘、`userData` 配置、密钥管理入口、打包脚本和同步机制
- 目前仍是实验性桌面壳，不是主文档中的默认生产 agent 形态

## 默认端口与地址

- `webserver/server`：`3100`
- `localapp` 默认上连地址：`ws://localhost:3100/ws/agent`
- `webserver/client` 开发服务器：`5173`
- `localapp` 本地调试接口默认端口：`3210`

## 登录与会话

### 浏览器登录

- 浏览器通过 `/api/auth/login` 登录
- 服务端使用 `user_sessions` 保存登录态
- 会话通过 HTTP-only cookie 维持
- `/api/auth/session` 用于恢复登录状态
- `/api/auth/logout` 用于退出

### 用户能力

- 支持公开注册：`/api/auth/register`
- 支持修改自己的密码：`/api/auth/change-password`
- 管理员支持用户列表、创建用户、修改角色/启停、重置密码

### 角色模型

当前角色仍是基础三档：

- `admin`
- `operator`
- `viewer`

尚未实现更细粒度的 RBAC。

## `auth_code` 与安全链路

### `auth_code` 绑定

- 每个用户可按 `agentId` 维护自己的 RSA 公钥绑定
- 数据表为 `user_auth_codes`
- 服务端会对 PEM 做规范化，并计算 SHA-256 指纹
- 前端已支持列表、创建、更新、删除

### 密钥职责

当前安全链路使用两套密钥：

- `localapp` 自身 RSA 密钥：
  - `auth_public.pem` 提供给服务端做加密
  - `auth_private.pem` 留在目标机本地做解密
- `webserver` 签名 RSA 密钥：
  - 私钥在服务端签名
  - 公钥分发到 `localapp` 做验签

### 当前已落地的安全消息类型

`webserver -> localapp` 侧已落地：

- `command.execute.secure`
- `terminal.session.create.secure`
- `terminal.session.input.secure`
- `terminal.session.resize.secure`
- `terminal.session.terminate.secure`
- `file.read.secure`

### `localapp` 执行前校验

`localapp` 当前会在执行前校验：

- 消息类型
- 服务端签名
- 本地私钥解密
- `agentId`
- `expiresAt`
- `nonce` 防重放

并且会明确拒绝不安全的明文 `command.execute`。

### 安全实现边界

- 当前安全封装主要覆盖 `server -> agent` 链路
- `agent -> server` 回传结果仍是现有 WebSocket 业务消息
- 安全实现的共享事实来源是 `shared/secure-command.mjs`

## 一次性命令链路

### 服务端入口

- REST：`POST /api/commands`

### 行为

- 浏览器提交 `agentId + command`
- 服务端按当前用户和目标设备查找 `auth_code`
- 成功后生成 `command.execute.secure`
- 如果 agent 在线则立即派发，否则进入 `queued`
- agent 串行执行，回传：
  - `command.started`
  - `command.finished`

### 持久化

- 内存态：`CommandStore`
- MySQL 摘要表：`command_runs`

当前只持久化输出摘要与字符数，不默认完整落库整段 `stdout` / `stderr`。

## 交互式终端会话链路

### 服务端入口

- `GET /api/terminal-sessions`
- `GET /api/terminal-sessions/:sessionId`
- `POST /api/terminal-sessions`
- `POST /api/terminal-sessions/:sessionId/input`
- `POST /api/terminal-sessions/:sessionId/terminate`
- `DELETE /api/terminal-sessions/:sessionId`

### agent 侧能力

`localapp` 当前已实现：

- `node-pty` PTY 会话创建
- stdin 持续写入
- 输出流持续回传
- resize
- terminate
- 空闲超时自动回收
- agent 重连时上报当前活动会话

### 会话 profile

当前 profile 由 `ToolProfileRegistry` 管理，内置/配置项与本机环境探测结果会统一合并后用于终端会话。

当前仓库内已覆盖的常见 profile：

- `default_shell_session`
- `claude_code_session`
- `codex_code_session`

此外，`localapp` 现在还会按内置候选集和 `DISCOVER_TERMINAL_COMMANDS` 对目标环境做可执行命令探测，把可直接启动的 shell / CLI 以 `discovered_*` profile 的形式一并上报给服务端和浏览器。

profile 当前可约束：

- 运行器类型
- 启动命令
- 允许的工作目录
- 环境变量 allowlist
- 输出模式
- 空闲超时

浏览器端会把这些 profile 按“预设 profile / 环境 Shell / 环境 CLI”分组显示，并允许直接搜索选择。

### 服务端侧处理

服务端当前会：

- 派发创建/输入/缩放/终止消息
- 缓存活动会话输出
- 从输出中提取 `final_text`
- 记录 turn 级输入/结果摘要
- 浏览器重连时通过 `snapshot` 恢复会话列表
- agent 重连时尝试与活动会话重新对齐

### 持久化

- 内存态：`TerminalSessionStore`
- MySQL：
  - `terminal_sessions`
  - `terminal_session_turns`

当前仍以“摘要持久化”为主，不是完整原始终端流长期落库。

## 远程文件预览

### 服务端入口

- `POST /api/remote-files/read`

### 当前能力

- 通过 `file.read.secure` 请求目标 agent 读取文本文件
- 可结合当前终端会话自动解析相对路径
- 仅支持文本预览
- 超出上限时截断返回
- 会识别常见编码，Windows 下支持本地编码回退

当前前端已支持在终端详情页中打开和预览文本文件。

## `localapp` 模块说明

### 运行特征

- 主动连接 `/ws/agent`
- 自动重连和心跳
- 命令串行队列
- 终端会话独立于一次性命令队列
- 网络断开时可缓存待回传消息到 outbox
- Windows 输出默认按 `cp936` 解码

### 本地调试入口

可选开启本地调试 HTTP 服务，默认：

- 仅监听 `127.0.0.1`
- 需要 `LOCAL_DEBUG_TOKEN`

当前已实现接口：

- `GET /api/debug/health`
- `POST /api/debug/commands`
- `GET /api/debug/terminal-sessions`
- `POST /api/debug/terminal-sessions`
- `GET /api/debug/terminal-sessions/:sessionId`
- `POST /api/debug/terminal-sessions/:sessionId/input`
- `POST /api/debug/terminal-sessions/:sessionId/terminate`

## `webserver/server` 模块说明

### 核心职责

- 处理登录、会话、用户、`auth_code`
- 维护在线 agent 注册表
- 为命令/终端/文件读取生成安全 envelope
- 向浏览器广播实时状态
- 落命令与终端摘要到 MySQL

### 状态边界

持久化到 MySQL：

- 用户
- 浏览器会话
- `auth_code`
- 一次性命令摘要
- 终端会话摘要
- 终端会话 turn 摘要

只保存在内存：

- 当前在线 agent
- 当前活动命令缓存
- 当前活动终端会话输出缓存
- 待完成的远程文件读取请求

## `webserver/client` 模块说明

当前控制台已覆盖：

- 登录页
- 首页设备概览
- 一次性命令面板
- 交互式会话面板
- 终端输出查看
- `final_text` 查看
- 远程文件预览
- `auth_code` 管理
- 账号安全
- 用户管理

## 通信协议

### agent -> server

- `agent.register`
- `agent.heartbeat`
- `command.started`
- `command.finished`
- `terminal.session.created`
- `terminal.session.resized`
- `terminal.session.output`
- `terminal.session.closed`
- `terminal.session.error`
- `file.read.completed`
- `file.read.error`

### server -> agent

- `command.execute.secure`
- `terminal.session.create.secure`
- `terminal.session.input.secure`
- `terminal.session.resize.secure`
- `terminal.session.terminate.secure`
- `file.read.secure`

### server -> browser

- `snapshot`
- `agent.updated`
- `command.updated`
- `terminal.session.updated`
- `terminal.session.output`
- `terminal.session.deleted`
- `terminal.session.input.ack`

## 典型时序

### 一次性命令

1. agent 启动后连接 `/ws/agent`
2. agent 发送 `agent.register`
3. 浏览器登录并提交 `/api/commands`
4. 服务端生成 `command.execute.secure`
5. agent 验签、解密、执行
6. agent 回传 `command.started` / `command.finished`
7. 服务端更新状态并广播给浏览器

### 交互式终端

1. 浏览器提交 `/api/terminal-sessions`
2. 服务端生成 `terminal.session.create.secure`
3. agent 创建 PTY 会话并回传 `terminal.session.created`
4. 浏览器通过 `/api/terminal-sessions/:sessionId/input` 继续输入
5. agent 持续回传 `terminal.session.output`
6. 浏览器可继续 resize、终止、删除已结束会话

### 远程文件读取

1. 浏览器提交 `/api/remote-files/read`
2. 服务端生成 `file.read.secure`
3. agent 读取文件并返回 `file.read.completed` 或 `file.read.error`
4. 服务端将结果同步回浏览器

## 日志

### 服务端日志

- 目录：`webserver/server/logs/`
- `server.log`
- `command.log`

### agent 日志

- 目录：`localapp/logs/`
- `agent.log`
- `command.log`

### 日志格式

- 使用 `log4js`
- 单行 JSON 结构化事件

## 当前实现边界

- 角色模型仍较粗，不是细粒度 RBAC
- 默认不做命令白名单，生产环境建议补策略控制
- 在线状态与活动输出仍以内存为主，服务端重启后需要重新等待 agent 上线
- 一次性命令仅保存摘要，不默认保存完整输出
- 终端会话主要保存摘要、尾部 transcript 和 `final_text`
- `localapp2` 仍是实验性桌面壳，不能替代 `localapp` 作为默认生产 agent
