# 开发协作与验证约定

更新时间：2026-05-20

## 适用范围

本文档承接 `CLAUDE.md` 中不适合长期堆放的开发细则，面向 Claude / Codex 在本仓库内改代码、补文档、做验证时使用。

## 基本原则

- 先读相关源码，再决定是否参考设计文档。
- 源码、数据库脚本和环境变量模板优先级高于历史文档。
- 修改应保持增量，优先沿用现有 JavaScript、ESM、Express、ws、Vue 3、Element Plus 风格。
- 用户可见文案和表单提示优先保持中文风格。
- 除非任务明确扩大范围，不要顺手引入新的框架层或大规模重构。

## 分支内容改动指引

### `localapp`

- 重点入口：`localapp/src/agent-client.js`、`localapp/src/command-runner.js`、`localapp/src/runtime/*`、`localapp/src/security/secure-command-service.js`。
- 一次性命令保持串行队列语义。
- PTY 会话和远程文件读取应继续复用安全消息链路。
- Windows 输出编码和 `which nodejs` 兼容层不要无关改动。

### `webserver/server`

- 主要 REST API 和 WebSocket 逻辑仍集中在 `webserver/server/src/index.js`。
- 用户、会话、审核、`auth_code` 相关改动要同时检查 `db/init.sql`、`src/auth/*`、`src/agents/*`、`src/db/schema-service.js`。
- 在线 agent、活动命令、活动终端输出仍包含内存态，不要默认当作完整数据库实现。
- 新增持久化字段时，同时考虑初始化 SQL 和启动时 schema 补齐逻辑。

### `webserver/client`

- 当前前端已有 router、全局 store、页面组件和通用组件拆分。
- 改页面前先看 `webserver/client/src/stores/console.js` 的数据流和 WebSocket 事件处理。
- UI 改动延续 Element Plus + 自定义 CSS 的现有风格，不要整页换成另一套脚手架式 UI。
- 移动端要检查底部导航、顶部栏、弹窗、长文本、长设备名、按钮换行和横向溢出。

### `shared`

- `shared/secure-command.mjs` 是安全链路单一事实来源。
- server 和 agent 两侧需要的安全能力优先在这里复用或扩展。
- 不要在业务文件里复制一套 RSA / AES / 签名 / 验签实现。

## 安全链路硬性要求

1. 不要恢复明文 `command.execute` 作为默认下发路径。
2. 不要删除 agent 侧 `agentId`、`expiresAt`、`nonce` 校验。
3. 不要在日志、接口响应、前端 UI 中暴露私钥或完整密钥 PEM。
4. 修改 `auth_code` 时必须保持 RSA PEM 规范化和 SHA-256 指纹计算。
5. 设备绑定继续遵守设备审核和 `agentId` 全局唯一绑定约束。
6. 下行新增敏感业务消息时，优先设计为 `*.secure` 并复用现有 envelope。

## 日志约定

服务端日志默认在：

- `webserver/server/logs`

agent 日志默认在：

- `localapp/logs`

日志通过 `log4js` 输出，并使用 `logEvent(logger, level, event, payload)` 包装结构化 JSON 事件体。

修改日志时注意：

- 保持结构化字段，便于检索。
- 不记录私钥明文。
- 不打印完整密钥 PEM。
- 命令输出可能包含敏感信息，新增日志时控制暴露面。

## 常用验证

这个仓库当前没有成体系的自动化测试脚本。改动后至少执行与任务相关的最小验证：

- 前端改动：`npm run build:client`
- 服务端登录/会话/API 改动：手动冒烟登录、恢复会话、退出登录和相关 REST API。
- WebSocket 改动：手动确认浏览器能收到 `snapshot`、`agent.updated`、`command.updated` 或终端事件。
- agent / 安全链路改动：跑通一次“绑定公钥 -> 发命令 -> agent 验签解密 -> 返回结果”。
- 终端会话改动：创建会话、输入命令、resize、终止、删除，并检查输出回传。
- 远程文件读取改动：验证文本文件、长文件截断、相对路径和错误态。
- 数据库改动：同时检查 `db/init.sql` 与服务启动时 schema 兼容性。

## 常用启动顺序

典型联调顺序：

1. `npm install`
2. 初始化 MySQL：`db/init.sql`
3. 生成密钥：`npm run auth:keygen:all`
4. 启动服务端：`npm run dev:server`
5. 启动前端：`npm run dev:client`
6. 启动 agent：`npm run dev:agent`
7. 浏览器登录 `admin / ChangeMe123!`
8. 让设备通过审核，并将 `localapp/keys/auth_public.pem` 录入对应 `auth_code`
9. 选择设备，发送 `hostname`、`whoami`、`ipconfig /all` 或 `uname -a` 做链路验证

## Git 提交规范

- 提交按功能模块拆分，一个 commit 只解决一类问题。
- 提交标题格式：`<type>: <简短主题>`
- 推荐 `type`：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`
- 标题主题使用中文，直接说明改了什么，不写空泛描述。
- 提交正文与标题之间保留一个空行。
- 提交正文至少说明这次一起改了哪些关键项，以及为什么这样改。
- 如果改动涉及端口、配置、协议、脚本或跨服务联动，正文里明确写出受影响服务名、关键配置项或关键文件。

示例：

```text
chore: 统一 game-proxy 默认端口配置

将 game-proxy 默认监听端口和 auth-http 默认下发的 GAME_PROXY_PORT 一并调整为 4000，并同步更新 port.txt 与示例环境变量，避免与 game-server 端口段混用，减少联调时连错入口的问题。
```

## 文档维护

- `CLAUDE.md` 只保留入口简介、核心介绍、分支内容简介和引用文档。
- 专题细节放在 `docs/` 下对应文档中。
- 如果代码能力已经落地，不要继续在文档里写成“未来新增”或“尚未完成”。
- 修改安全、审核、终端、部署相关实现时，同步检查对应专题文档是否需要更新。
