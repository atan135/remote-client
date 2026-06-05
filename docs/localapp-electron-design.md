# localapp2 Electron Windows 客户端说明

更新时间：2026-05-20

## 文档定位

本文按当前源码说明 `localapp2` 的真实状态。`localapp2` 已经不只是“未来新增的 Electron 壳”，也不再只是配置和密钥 UI；它已经通过同步机制接入了 `localapp` 的主要运行时能力。

主要实现入口：

- `localapp2/electron/main.cjs`
- `localapp2/electron/preload.cjs`
- `localapp2/renderer/src/App.vue`
- `localapp2/src/runtime-adapter.js`
- `localapp2/src/config-store.js`
- `localapp2/src/key-manager.js`
- `localapp2/src/runtime-state-store.js`
- `localapp2/src/synced/*`
- `localapp2/tools/sync-localapp-files.mjs`

## 结论

当前合理定位：

1. `localapp` 仍是默认后台 agent。
2. `localapp2` 是已接入真实 agent runtime 的实验性 Electron Windows 客户端。
3. `localapp2` 已具备连接服务端、验签解密、一次性命令、PTY 会话、本地调试、远程文件读取、配置、密钥和状态展示能力。
4. 它仍未抽出长期稳定的共享 `agent-core` 包，当前依赖同步生成文件复用 `localapp` 主实现。
5. 当前仍不建议把 `localapp2` 描述为成熟生产替代品，但“运行时未接线”的旧说法已经过期。

## 当前已落地能力

### 1. Workspace 与脚本

根目录已有：

- `dev:agent2`
- `build:agent2`
- `sync:agent2`
- `check:agent2-sync`

`localapp2/package.json` 已有：

- `sync:localapp`
- `check:localapp-sync`
- `verify:chain`
- `dev`
- `build`
- `dist:win`

### 2. Electron 宿主层

当前已存在：

- 单实例锁
- 主窗口
- 托盘
- 双击托盘显示主界面
- 关闭窗口时隐藏到托盘
- 开机自启设置
- `preload + IPC` 受控 API 暴露
- 配置更新后重启 runtime

关键文件：

- `localapp2/electron/main.cjs`
- `localapp2/electron/preload.cjs`

### 3. 配置与数据落盘

`localapp2` 使用 Electron `userData` 目录维护本地状态：

- `config.json`
- `keys/`
- `logs/`
- `appdata/tool-profiles.json`

`ConfigStore` 当前支持：

- 服务端 WebSocket 地址
- `agentId` / `agentLabel` / 设备申请备注 / shared token
- 心跳、重连、命令超时和缓冲配置
- 日志目录与日志级别
- Windows 输出编码、ConPTY 配置
- 本机 auth 私钥 / 公钥路径
- 服务端签名公钥路径
- 远程文件读取上限
- 终端会话上限、输出上限、空闲超时
- profile 配置路径
- 常用目录、允许 cwd 根目录、预设命令
- 本地调试服务配置
- 托盘关闭与开机自启配置

### 4. 密钥管理

`localapp2/src/key-manager.js` 当前支持：

- 生成 `auth_private.pem` / `auth_public.pem`
- 导入 `webserver_sign_public.pem`
- 读取本机公钥
- 计算本机公钥指纹和服务端签名公钥指纹
- 判断 `keysReady`

Electron IPC 当前包括：

- `rsa:generate-localapp2`
- `rsa:import-webserver-public-key`
- `keys:get-summary`
- `keys:read-auth-public`
- `shell:open-key-dir`

### 5. 运行时接线

`localapp2/src/runtime-adapter.js` 当前已经接入：

- `AgentClient`
- `ExecutionGateway`
- `PtySessionManager`
- `SessionStore`
- `ToolProfileRegistry`
- `LocalDebugServer`

这意味着 `localapp2` 当前可以复用 `localapp` 同步过来的主要能力：

- 主动连接 `/ws/agent`
- 自动重连
- 验签解密安全命令
- 一次性命令执行
- 远程 PTY 会话创建、输入、resize、终止
- 远程文本文件读取
- 本地调试接口
- profile 注册与探测
- 向服务端注册当前活动远程终端会话

### 6. 状态展示

Renderer 当前能展示：

- runtime 启停状态
- 服务端连接状态
- 设备审核准入状态与原因
- `agentId` / `serverWsUrl`
- 最近错误
- 命令队列长度
- 缓冲消息数
- 密钥状态和公钥内容
- 终端 profile 数量
- 活动终端会话列表
- 日志目录、配置路径、密钥目录和 profile 配置路径

### 7. 同步机制

当前仍通过同步机制复用 `localapp` 主实现：

- `localapp2/tools/localapp-sync.manifest.json`
- `localapp2/tools/sync-localapp-files.mjs`
- `localapp2/src/synced/*`

同步内容包括：

- `agent-client.js`
- `command-runner.js`
- `file-reader.js`
- `local-debug-server.js`
- `security/secure-command-service.js`
- `runtime/*`
- `shared/secure-command.mjs`
- `config/tool-profiles.json`

同步生成文件头部包含来源和 SHA-256 标记。

### 8. Windows 打包

`localapp2/package.json` 已配置：

- `electron-builder`
- Windows `nsis`
- Windows `portable`

`dist:win` 已是实际脚本。

## 与 `localapp` 的关系

### `localapp`

适合：

- 后台部署
- 无人值守
- `pm2` 或 system service 守护
- 作为默认生产 agent

### `localapp2`

适合：

- Windows 桌面安装
- 托盘常驻
- 图形化配置
- 本地密钥管理
- 桌面端可视化状态查看
- 需要 GUI 降低接入门槛的场景

## 共存规则

### 1. 不要共用 `agentId`

服务端在线注册表和 `auth_code` 归属都按 `agentId` 识别设备。`localapp` 与 `localapp2` 共用 `agentId` 会导致：

- 在线状态互相覆盖
- 命令目标不确定
- 设备审核和 `auth_code` 归属混乱

### 2. 不要共用密钥目录

每个 agent 身份都应有自己的 `auth_private.pem` / `auth_public.pem`。

`auth_code` 绑定的是某个 `agentId` 的公钥；混用密钥会导致设备身份、审核记录和控制链路难以排查。

### 3. 不要共用日志和配置目录

`localapp` 是 CLI / service 场景，`localapp2` 是 Electron `userData` 场景。配置、日志和密钥目录应保持隔离。

## 当前边界

- 尚未抽出正式的 `packages/agent-core`，同步机制仍是工程折中。
- Electron 端虽然接入 runtime，但生产部署、自动升级、错误恢复和安装后体验还需要继续打磨。
- `localapp2` 主要面向 Windows 桌面场景，不替代 Linux / 服务器后台部署。
- GUI 当前以配置、密钥和状态查看为主，不是完整远程控制台。
- 长期仍需要减少 `localapp` 与 `localapp2` 的运行时漂移风险。

## 后续建议

1. 抽出共享 `agent-core`，让 CLI 壳和 Electron 壳依赖同一个稳定 runtime 包。
2. 完善 Electron 端安装、升级、日志导出、错误排障和权限提示。
3. 保持 `localapp2/tools/sync-localapp-files.mjs --check` 作为 CI 或发布前检查。
4. 明确 `localapp2` 与生产 `localapp` 的部署边界，避免同一设备重复注册。
