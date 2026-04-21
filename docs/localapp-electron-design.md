# localapp2 Electron Windows 客户端设计与当前实现状态

更新时间：2026-04-21

## 背景

当前仓库已经同时存在两条客户端形态：

- `localapp`：纯 Node.js 常驻 agent，面向后台部署
- `localapp2`：Electron Windows 桌面工具骨架，面向人工安装、托盘常驻、图形化配置和密钥管理

本文不再把 `localapp2` 视为“未来新增项”，而是同时说明：

- 当前仓库里 `localapp2` 已经落地到了哪一步
- 它与 `localapp` 的关系
- 后续仍建议怎样演进

## 结论先行

当前方向仍然正确：

1. 保留 `localapp` 作为默认后台 agent
2. 保留 `localapp2` 作为独立 Electron workspace
3. 两者不能共用 `agentId`、密钥目录、日志目录
4. `localapp2` 当前已具备桌面壳能力，但还不是 `localapp` 的完整功能等价替代

## 当前仓库里 `localapp2` 已经落地的内容

## 1. Workspace 与脚本

当前根目录已经有：

- `dev:agent2`
- `build:agent2`
- `sync:agent2`
- `check:agent2-sync`

当前 `localapp2/package.json` 已经有：

- `sync:localapp`
- `check:localapp-sync`
- `verify:chain`
- `dev`
- `build`
- `dist:win`

这意味着：

- `localapp2` 不再是文档中的“未来目录”
- Electron 开发、构建和 Windows 打包脚本都已经存在

## 2. Electron 宿主层

当前已存在：

- `localapp2/electron/main.js`
- `localapp2/electron/preload.js`
- `localapp2/renderer/index.html`
- `localapp2/renderer/src/App.vue`
- `localapp2/renderer/src/main.js`

当前已落地的宿主能力：

- 单实例锁
- 主窗口
- 托盘
- 双击托盘显示主界面
- 关闭窗口时可隐藏到托盘
- `openAtLogin` 开机自启设置
- `preload + IPC` 受控 API 暴露

## 3. 配置与数据落盘

当前 `localapp2` 已经不走 `localapp/.env` 直接复用模式，而是：

- 以 `app.getPath("userData")` 作为根目录
- 使用 `config.json`
- 单独维护 `keys/`
- 单独维护 `logs/`

当前关键实现：

- `localapp2/src/config-store.js`
- `localapp2/src/logger.js`

当前配置模型已覆盖：

- `serverWsUrl`
- `agentId`
- `agentLabel`
- `agentSharedToken`
- `heartbeatIntervalMs`
- `reconnectIntervalMs`
- `commandTimeoutMs`
- `maxBufferBytes`
- `windowsOutputEncoding`
- `closeToTray`
- `launchOnStartup`

## 4. 密钥管理

当前已存在：

- `localapp2/src/key-manager.js`

当前已落地能力：

- 生成 `auth_private.pem` / `auth_public.pem`
- 导入 `webserver_sign_public.pem`
- 读取和展示本机公钥
- 计算并展示公钥指纹
- 判断 `keysReady`

Electron 主进程当前已提供对应 IPC：

- `rsa:generate-localapp2`
- `rsa:import-webserver-public-key`
- `keys:get-summary`
- `keys:read-auth-public`

## 5. 状态展示骨架

当前 Renderer 已经有基础 UI，能展示：

- 连接状态
- `agentId`
- `serverWsUrl`
- 最近错误
- 命令队列长度
- 缓冲消息数
- 密钥状态
- 结构化状态快照

这意味着 `localapp2` 已经具备“本地桌面管理壳”的最小可用界面。

## 6. 代码同步机制

当前仓库已经真实落地了同步机制，而不是停留在建议：

- `localapp2/tools/localapp-sync.manifest.json`
- `localapp2/tools/sync-localapp-files.mjs`
- `localapp2/src/synced/*`

当前 `src/synced` 下已有：

- `agent-client.js`
- `command-runner.js`
- `logger.js`
- `security/secure-command-service.js`

同步生成文件头部也已经带了来源和 SHA-256 标记。

## 7. Windows 打包

当前 `localapp2/package.json` 已配置：

- `electron-builder`
- Windows 目标：
  - `nsis`
  - `portable`

当前 `dist:win` 已是实际存在的脚本，不再是未来规划。

## 为什么仍然不能把 `localapp2` 当作完成版替代 `localapp`

虽然桌面壳已经有了，但当前实现仍有明显边界。

## 1. 还没有抽出真正共享的 `agent-core`

当前仍是：

- `localapp` 维护主实现
- `localapp2` 通过同步机制复用部分文件

尚未完成：

- `packages/agent-core`
- CLI 壳 / Electron 壳共享同一套稳定 runtime 包

这意味着当前同步机制仍是工程折中，不是最终架构。

## 2. 运行时接线还不是完整等价

`localapp2/src/runtime-adapter.js` 当前重点是：

- 启停桌面端 runtime
- 维护状态快照
- 对接配置和密钥状态

但它还没有像 `localapp/src/index.js` 一样，把完整的：

- `ExecutionGateway`
- `PtySessionManager`
- `SessionStore`
- `ToolProfileRegistry`
- `LocalDebugServer`

全部拼装进去。

这意味着当前 `localapp2` 更接近：

- “已能启动、配置、管理、安全准备好的 Electron agent 壳”

而不是：

- “和 `localapp` 功能完全等价的生产 agent”

## 3. 还没有形成完整桌面产品闭环

当前已做的是桌面基础能力，但还没有完全补齐：

- 终端会话/文件读取的完整运行时接线
- 更完善的错误态与排障体验
- 更成熟的 GUI 交互和安装后体验
- 与 `localapp` 的长期共享包沉淀

## `localapp` 与 `localapp2` 的共存规则

这部分结论没有变化，仍然是硬约束。

## 1. 不能共用同一个 `agentId`

服务端在线注册表按 `agentId` 建立映射，若两者共用同一个 `agentId`，会导致：

- 在线状态互相覆盖
- 命令目标不确定
- `auth_code` 绑定失去区分意义

## 2. 不能共用同一套密钥目录

原因：

- `auth_public.pem` 对应的就是某个具体 agent 身份
- `auth_code` 绑定是按 `(user_id, agent_id)` 管理

因此：

- `localapp` 和 `localapp2` 必须分别生成自己的本地密钥

## 3. 不能共用日志和配置目录

原因：

- 一个是 CLI/pm2 场景
- 一个是 Electron/userData 场景

目录模型本来就不同，强行共用只会造成排障和升级混乱。

## 当前推荐定位

## `localapp`

适合：

- 后台部署
- 无人值守
- `pm2` 或 system service 守护
- 作为主生产 agent

## `localapp2`

适合：

- Windows 桌面安装
- 托盘常驻
- 图形化配置
- 本地密钥管理
- 给需要 GUI 的用户提供更低门槛的接入方式

## 当前更合理的文档结论

当前不应再写成“localapp2 未来新增”，而应写成：

> `localapp2` 已经完成 Electron 外壳、托盘、`userData` 配置、密钥管理入口、同步机制和 Windows 打包脚本的第一阶段落地；但共享 `agent-core` 仍未抽离，运行时接线也还没有完全达到 `localapp` 的功能等价，因此当前更适合作为实验性桌面客户端骨架，而不是直接替代 `localapp` 的生产版本。

## 后续建议

### 1. 抽出共享 `agent-core`

优先级最高的长期工作仍然是：

- 把真正通用的 runtime 从 `localapp` / `localapp2` 两侧抽出来

### 2. 补齐 Electron 运行时能力

让 `localapp2` 真正接上：

- 完整命令执行网关
- PTY 会话管理
- profile 注册
- 文件读取链路

### 3. 保持同步机制只做过渡

当前同步机制已经能用，但不建议长期把它当最终方案。

## 最终建议

当前项目最合理的描述是：

1. `localapp` 继续作为默认后台 agent
2. `localapp2` 已经完成第一阶段桌面壳落地
3. `localapp2` 当前可以作为实验性 Windows 客户端继续推进
4. 真正的长期目标仍然是抽出共享 `agent-core`，避免两套 runtime 漂移
