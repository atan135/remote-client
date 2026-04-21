# 文档同步记录

更新时间：2026-04-21

## 背景

此前 `docs` 下多份设计文档仍把若干能力写成“待开发”“未来新增项”或“当前尚未完成”，但这些能力已经在当前仓库源码中落地。

本次工作不再保留旧的“文档与代码不一致问题清单”，而是把相关文档直接同步到当前实现状态，并在这里记录同步结果。

## 本次已同步的文档

### 1. `docs/architecture.md`

已改为“当前实现说明”，不再按纯设计稿描述。当前文档已明确写入：

- 安全消息链路已落地，包括：
  - `command.execute.secure`
  - `terminal.session.create.secure`
  - `terminal.session.input.secure`
  - `terminal.session.resize.secure`
  - `terminal.session.terminate.secure`
  - `file.read.secure`
- 浏览器实时消息已覆盖：
  - `terminal.session.updated`
  - `terminal.session.output`
  - `terminal.session.deleted`
  - `terminal.session.input.ack`
- 交互式 PTY 会话、远程文本文件预览、摘要持久化、local debug 接口都已落地
- `localapp2` 已补充为“实验性 Electron 客户端骨架”，并明确它还不能替代 `localapp`

### 2. `docs/auth-code-rsa-design.md`

已改为“设计与当前实现”口径，不再保留“尚未完成”的旧状态判断。当前文档已明确写入：

- `user_auth_codes` 已落库
- Web 端 `auth_code` CRUD 已存在
- 服务端签名与加密已存在
- `localapp` 的验签、解密、`agentId` / `expiresAt` / `nonce` 校验已存在
- 同一套安全 envelope 已同时用于命令、终端会话和远程文件读取

### 3. `docs/localapp-electron-design.md`

已改为“设计与当前实现状态”。当前文档已明确写入：

- `localapp2` 已有独立 workspace、Electron 主进程、托盘、`userData` 配置、密钥管理入口
- 同步机制已落地，根目录已有 `dev:agent2`、`build:agent2`
- `localapp2/package.json` 已有 `dist:win`
- `localapp2` 当前仍是实验性桌面壳，不应描述为 `localapp` 的完整等价替代

### 4. `docs/localapp-external-terminal-design.md`

已改为“当前双通道远程执行架构说明”。当前文档已明确写入：

- 快速命令通道已落地
- PTY 会话通道已落地
- 本地调试入口已落地
- 远程文本文件读取已落地
- `claude_code_session` 与 `codex_code_session` profile 已存在

### 5. `docs/remote-client-vs-openclaw.md`

补充了项目与 OpenClaw 的对比文档，基于当前代码能力整理差异，包括：

- 控制面隐私与暴露面
- 真实终端会话保持
- 确定性远程命令执行链路
- 安全模型
- 持久化与审计边界
- 扩展生态与运维复杂度

## 本次对照的主要实现入口

- `localapp/src/agent-client.js`
- `localapp/src/runtime/*`
- `localapp/src/local-debug-server.js`
- `localapp/config/tool-profiles.json`
- `webserver/server/src/index.js`
- `webserver/server/src/security/secure-command-service.js`
- `shared/secure-command.mjs`
- `db/init.sql`
- `localapp2/*`

## 当前仍需注意的边界

- `localapp2` 虽然已具备桌面壳、配置、密钥和打包能力，但运行时接线仍未完全达到 `localapp` 等价水平
- 当前系统对命令权限的控制仍以基础角色和 profile/cwd/env 限制为主，不是细粒度策略引擎
- 在线状态与活动终端输出仍主要保存在内存中，服务端重启后需要等待 agent 重新上报

## 结果

截至 2026-04-21，前述几份核心设计文档已经按当前源码同步，不再继续保留“这些能力尚未开发”的过期结论。
