# 功能架构说明

## 目标

实现一个“内网 agent 主动外连 + 外网控制台下发命令 + 结果回传”的双端系统。

## 默认端口

- `webserver/server`：`3100`
- `localapp` 默认上连地址：`ws://localhost:3100/ws/agent`
- `webserver/client` 开发代理：`http://localhost:3100`

## 登录与会话

- `webserver/server` 使用 MySQL 保存用户和会话
- 浏览器通过 `/api/auth/login` 提交用户名和密码
- 浏览器可通过 `/api/auth/register` 公开注册账号
- 服务端验证成功后写入 HTTP-only session cookie
- 后续 `/api/agents`、`/api/commands` 和 `/ws/browser` 都基于会话校验
- 用户可通过 `/api/auth/change-password` 修改自己的密码
- 管理员可通过 `/api/users` 系列接口管理用户和重置密码

## 安全命令加密设计

- 设计文档：[auth-code-rsa-design.md](/c:/project/remote-client/docs/auth-code-rsa-design.md)
- 目标是在 `webserver -> localapp` 命令链路中增加基于 `auth_code + RSA` 的加密与校验机制
- 当前设计采用两套密钥：`localapp` 自身 RSA 密钥负责解密，`webserver` 自身 RSA 密钥负责签名
- `auth_code` 将从 `users` 表拆出，独立存到用户与 `agent` 的绑定表中
- 已补充密钥生成工具，可通过根目录脚本 `npm run auth:keygen:localapp` 和 `npm run auth:keygen:webserver` 生成密钥对
- 加密下发、验签和解密执行链路仍处于待开发状态

## 数据库

- 初始化脚本：[init.sql](/c:/project/remote-client/db/init.sql)
- 数据库名：`remote_client`
- 字符集：`utf8mb4`
- 主要表：
- `users`：控制台登录用户
- `user_sessions`：浏览器登录会话
- `user_auth_codes`：用户与 `agent` 的公钥绑定关系，作为安全命令加密设计中的新增表

## 模块划分

### 1. `localapp`

职责：

- 常驻运行在内网机器
- 主动连接 `webserver/server`
- 支持断线重连和心跳
- 串行执行命令，避免并发命令互相影响
- 在网络抖动时缓存未回传的执行结果

核心文件：

- [config.js](/c:/project/remote-client/localapp/src/config.js)
- [agent-client.js](/c:/project/remote-client/localapp/src/agent-client.js)
- [command-runner.js](/c:/project/remote-client/localapp/src/command-runner.js)
- [logger.js](/c:/project/remote-client/localapp/src/logger.js)

### 2. `webserver/server`

职责：

- 提供 REST API 给浏览器下发命令
- 提供 WebSocket 给 agent 建立长连接
- 提供 WebSocket 给浏览器接收实时状态
- 保存在线设备和命令记录
- agent 重连后自动补发排队命令

核心文件：

- [index.js](/c:/project/remote-client/webserver/server/src/index.js)
- [agent-registry.js](/c:/project/remote-client/webserver/server/src/state/agent-registry.js)
- [command-store.js](/c:/project/remote-client/webserver/server/src/state/command-store.js)
- [logger.js](/c:/project/remote-client/webserver/server/src/logger.js)

### 3. `webserver/client`

职责：

- 展示在线设备
- 选择目标设备并发送命令
- 通过浏览器 WebSocket 实时刷新结果

核心文件：

- [App.vue](/c:/project/remote-client/webserver/client/src/App.vue)
- [styles.css](/c:/project/remote-client/webserver/client/src/styles.css)

## 通信协议

### agent -> server

- `agent.register`
- `agent.heartbeat`
- `command.started`
- `command.finished`

### server -> agent

- `command.execute`

### server -> browser

- `snapshot`
- `agent.updated`
- `command.updated`

## 时序

1. agent 启动后主动连接 `/ws/agent`
2. agent 发送 `agent.register`
3. 浏览器请求 `/api/agents`、`/api/commands`
4. 浏览器通过 `/api/commands` 提交命令
5. 服务端如果 agent 在线则立即推送 `command.execute`，否则进入 `queued`
6. agent 收到后执行本地命令，回传开始与结束事件
7. 服务端更新状态并通过 `/ws/browser` 广播到前端

## 日志

### 服务端日志

- 目录：`webserver/server/logs/`
- `server.log`：服务启动、agent 连接/断开、WebSocket 鉴权失败、进程异常
- `command.log`：web 端命令提交、排队、派发、开始执行、执行结果

### 内网 agent 日志

- 目录：`localapp/logs/`
- `agent.log`：agent 启动、连接、重连、消息缓存、进程异常
- `command.log`：本地收到的命令、开始执行、执行结果（包含 `stdout`、`stderr`、退出码）

### 日志格式

- 使用 `log4js`
- 采用单行 JSON 事件体，方便后续按关键字或日志采集系统解析
- 默认保留 14 天，可通过 `.env` 中的 `LOG_LEVEL`、`LOG_DIR` 调整

## 当前实现边界

- 命令记录为内存存储，重启后不会保留
- 当前提供基础用户名密码登录，不包含更细粒度的 RBAC 权限模型
- 默认不做命令白名单，生产环境建议补上策略控制
- 当前前端面向单控制台使用场景，适合先验证链路与功能
