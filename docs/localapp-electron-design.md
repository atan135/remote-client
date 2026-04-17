# localapp2 Electron Windows 客户端设计方案

## 背景

当前仓库已经有一个可运行的 `localapp`，它是纯 Node.js 常驻 agent，负责：

- 主动连接 `webserver/server`
- 接收 `command.execute.secure`
- 验签、解密、防重放
- 串行执行命令并回传结果

后续需要把客户端拆成两条产品线，而不是把现有 `localapp` 直接改造成 Electron：

- `localapp`：继续保留，面向后台部署，使用 `pm2` 启动
- `localapp2`：新增的 Electron Windows 桌面工具，面向人工安装、托盘常驻、图形化配置和密钥管理

本文的目标不是“重写现有 agent”，而是设计一套 **额外新增 `localapp2`** 的方案，同时保证 `localapp` 继续可用。

## 结论先行

推荐方案：

1. 保留现有 `localapp` 作为独立 workspace，不直接混入 Electron 能力
2. 新增 `localapp2` workspace，作为 Electron Windows 客户端
3. 把真正需要复用的 agent 运行时能力抽成公共模块，供 `localapp` 和 `localapp2` 共用
4. `localapp` 和 `localapp2` 必须使用 **不同的 `agentId`、不同的密钥目录、不同的日志目录**

不推荐方案：

- 不要直接把当前 `localapp` 打包成 Electron
- 不要让 `localapp2` 直接读取 `localapp/.env`
- 不要让 `localapp2` 复用 `localapp/keys` 或 `localapp/logs`
- 不要让 `localapp` 和 `localapp2` 共用同一个 `agentId`

## 为什么不能直接改造当前 `localapp`

如果直接把现有 `localapp` 改造成 Electron，会同时破坏两条使用场景：

- 后台部署场景需要简单、稳定、无界面，适合 `pm2`
- 桌面工具场景需要窗口、托盘、配置界面、安装包和 Windows 用户目录

当前 `localapp` 的特点决定了它更适合作为后台 agent：

- 配置来源是 `.env`
- `keys/` 和 `logs/` 默认是相对路径
- 启动入口是 CLI 进程
- 没有托盘、IPC、窗口、安装器概念

如果强行在同一个包里同时兼容 `pm2` 和 Electron，会带来这些问题：

- 启动方式耦合，后台和桌面版互相影响
- 配置来源混乱，`.env` 和 `userData` 容易串
- 打包后路径不可写
- 后续发布、回滚、排障成本上升
- 一处改动容易同时影响 pm2 版和桌面版

所以这里的正确方向不是“升级 `localapp`”，而是“保留 `localapp`，新增 `localapp2`”。

## 当前代码基础

当前仓库里已经有不少可以直接复用的能力：

- `localapp/src/agent-client.js`
  负责 WebSocket 上连、重连、心跳、命令队列、状态回传
- `localapp/src/command-runner.js`
  负责本地命令执行和 Windows 输出解码
- `localapp/src/security/secure-command-service.js`
  负责验签、解密、`agentId` 校验、`expiresAt` 校验、`nonce` 防重放
- `localapp/src/logger.js`
  负责日志落盘
- `shared/secure-command.mjs`
  负责公钥规范化、指纹、混合加密、签名和验签
- `scripts/generate-rsa-keypair.js`
  负责生成 `localapp` 解密密钥和 `webserver` 签名密钥

这意味着：

- `localapp2` 不需要重新设计协议
- `localapp2` 不需要重新发明“安全命令”的加解密方案
- 重点在于抽离公共运行时，并在 Electron 外壳中补上 GUI、托盘、配置和本地文件落盘

## 产品定位

### `localapp`

定位：

- 无界面后台 agent
- 面向服务器、内网主机、长期驻留环境
- 由 `pm2` 启动和守护

推荐特征：

- 继续保留 `.env` 驱动
- 继续保留 CLI 入口
- 尽量少引入桌面依赖
- 后续可新增 `pm2 ecosystem` 配置，但不需要 Electron

### `localapp2`

定位：

- Windows 桌面工具
- 面向人工安装、手工配置、状态查看、密钥管理
- 由用户点击图标启动，最小化后进入托盘

推荐特征：

- Electron 主进程负责生命周期和后台运行
- Renderer 提供配置与状态 UI
- 配置、日志、密钥写入 `%APPDATA%` / `userData`
- 可选开机自启，但不依赖 `pm2`

## `localapp` 与 `localapp2` 的共存规则

这是设计里最关键的一条。

当前服务端的在线注册表 `AgentRegistry` 是按 `agentId` 建立映射的，`user_auth_codes` 绑定关系也按 `(user_id, agent_id)` 唯一约束保存。因此：

- `localapp` 和 `localapp2` **不能共用同一个 `agentId`**
- `localapp` 和 `localapp2` **不能共用同一条 `auth_code` 绑定**
- `localapp` 和 `localapp2` **不能共用同一套本地密钥目录**

如果两者使用同一个 `agentId`，会发生这些问题：

- 后连上的客户端覆盖先前在线状态
- 服务端向同一 `agentId` 派发命令时，目标会变得不确定
- `auth_code` 绑定会失去区分意义

推荐命名方式：

- `localapp`：`office-pc-01`
- `localapp2`：`office-pc-01-desktop`

或者更明确地按部署类型区分：

- `server-room-01-pm2`
- `frontdesk-01-electron`

## 推荐总体架构

推荐拆成三层：

1. `agent-core`
2. `localapp`
3. `localapp2`

其中：

- `agent-core`：真正复用的后台 agent 核心
- `localapp`：CLI / pm2 包装层
- `localapp2`：Electron 包装层

## 推荐目录结构

推荐在仓库中新增以下结构：

```text
.
├─ localapp/
│  ├─ package.json
│  ├─ .env.example
│  └─ src/
│     └─ index.js
├─ localapp2/
│  ├─ package.json
│  ├─ electron/
│  │  ├─ main.js
│  │  └─ preload.js
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ main.js
│  │     ├─ App.vue
│  │     ├─ styles.css
│  │     └─ components/
│  ├─ build/
│  │  └─ icon.ico
│  └─ src/
│     ├─ config-store.js
│     ├─ key-manager.js
│     ├─ runtime-adapter.js
│     └─ runtime-state-store.js
├─ packages/
│  └─ agent-core/
│     ├─ package.json
│     └─ src/
│        ├─ agent-runtime.js
│        ├─ agent-client.js
│        ├─ command-runner.js
│        ├─ logger.js
│        ├─ config-schema.js
│        └─ security/
│           └─ secure-command-service.js
└─ shared/
   └─ secure-command.mjs
```

如果第一期不想立即引入 `packages/agent-core`，也可以先把公共逻辑临时放在 `localapp2/src/runtime-adapter.js` 中，但这只是过渡方案，不建议长期维持两套实现。

## 第一阶段落地策略

为了尽快把 `localapp2` 跑起来，同时避免一开始就大规模重构 `localapp`，建议采用两阶段策略：

### 第一阶段：先搭 `localapp2` 外壳

目标：

- 创建 `localapp2` workspace
- 搭好 Electron 主进程、preload、Renderer 基础骨架
- 让 `localapp2` 可以启动窗口、进入托盘、读取本地配置
- 通过“代码同步机制”复用 `localapp` 的业务核心文件

这个阶段不追求马上抽出 `packages/agent-core`，而是先保证新客户端形态落地。

### 第二阶段：再把同步机制升级成共享包

目标：

- 把已经验证稳定的共用代码沉淀到 `packages/agent-core`
- 让 `localapp` 和 `localapp2` 都从共享包引入
- 最终替换掉临时的文件同步机制

换句话说：

- 第一阶段的“同步”是过渡方案
- 第二阶段的“共享包”才是长期方案

## 为什么推荐抽出 `agent-core`

如果 `localapp2` 直接复制 `localapp/src` 的代码，短期能跑，长期会产生这些问题：

- `localapp` 修了一个安全 bug，`localapp2` 可能忘记同步
- `localapp2` 增加了状态上报，`localapp` 又没有
- 两边日志字段逐渐分叉
- 协议升级时需要改两遍

因此更合理的做法是：

- 把可复用的 runtime 抽到 `packages/agent-core`
- `localapp` 作为 CLI 壳调用它
- `localapp2` 作为 Electron 壳调用它

建议抽出的内容：

- `AgentClient`
- `CommandRunner`
- `SecureCommandService`
- 日志接口
- 配置归一化
- 运行时事件和状态快照

继续保留在外围壳中的内容：

- `localapp`：`.env` 读取、CLI 启动、pm2 集成
- `localapp2`：窗口、托盘、IPC、配置文件、Windows 集成

## 哪些代码可以共用

结合当前 `localapp/src` 的实际实现，建议按下面三类看待。

### A. 可以直接共用或同步的代码

这部分业务逻辑和宿主形态关系弱，适合先同步到 `localapp2`，后续再抽共享包：

- `localapp/src/agent-client.js`
  - 负责 WebSocket 上连、重连、心跳、消息缓冲、命令队列
  - 当前主要依赖 `config`、`loggers`、`command-runner.js`、`security/secure-command-service.js`
  - 这是最核心的可复用文件之一
- `localapp/src/command-runner.js`
  - 纯命令执行和输出解码逻辑
  - 与 Electron 无强耦合
  - 适合直接共用
- `localapp/src/security/secure-command-service.js`
  - 验签、解密、防重放逻辑已经完整
  - 可以共用，但建议后续把“路径解析”抽成可配置

### B. 需要轻改后再共用的代码

这些代码目前和 `localapp` 的 CLI 形态或目录结构绑定较强，不能原封不动直接复用：

- `localapp/src/logger.js`
  - 当前默认把日志目录解析到 `localapp` 包目录
  - `localapp2` 需要写入 `userData`
  - 建议抽出“日志工厂”并允许外部传入基础目录
- `localapp/src/config.js`
  - 当前固定走 `.env`
  - `localapp2` 需要改为 `config.json + 开发态 .env + 默认值`
  - 这部分适合重写为“配置加载器接口”，不建议简单复制
- `scripts/generate-rsa-keypair.js`
  - 当前是 CLI 脚本
  - `localapp2` 需要一个可编程调用的 key generator 模块
  - 建议把核心逻辑抽模块，CLI 保留薄封装

### C. 不应该共用的代码

这些内容是宿主层或部署层，不应该通过同步共用：

- `localapp/src/index.js`
  - 这是 CLI 启动入口，不是 Electron 启动入口
- `localapp/.env`、`localapp/.env.example`
  - `localapp2` 的配置模型不同
- `localapp/keys/*`
  - `localapp2` 必须有独立密钥目录
- `localapp/logs/*`
  - `localapp2` 必须有独立日志目录
- `localapp/package.json`
  - `localapp2` 需要完全不同的依赖与脚本

## 第一阶段建议同步的文件清单

如果先采用“同步文件而不是共享包”的过渡方案，建议只同步下面这些源码：

```text
localapp/src/agent-client.js
localapp/src/command-runner.js
localapp/src/security/secure-command-service.js
```

并继续直接依赖已有共享文件：

```text
shared/secure-command.mjs
```

不建议第一阶段同步下面这些文件：

```text
localapp/src/index.js
localapp/src/config.js
localapp/src/logger.js
localapp/.env.example
```

原因很简单：

- 这些文件强绑定 `localapp` 的 CLI 入口、目录结构或 `.env` 模型
- 直接同步过去只会把 `localapp2` 也拖回 CLI 思路

## `localapp2` 第一阶段应生成的框架文件

为了让 `localapp2` 能先跑起来，建议第一阶段直接生成以下骨架：

```text
localapp2/
  package.json
  electron/
    main.js
    preload.js
  renderer/
    index.html
    src/
      main.js
      App.vue
      styles.css
  src/
    config-store.js
    key-manager.js
    runtime-adapter.js
    runtime-state-store.js
    synced/
      agent-client.js
      command-runner.js
      security/
        secure-command-service.js
  tools/
    sync-localapp-files.mjs
    localapp-sync.manifest.json
```

这些文件的职责建议如下：

- `package.json`
  - Electron、Vue、Vite、打包脚本、开发脚本
- `electron/main.js`
  - 应用生命周期、窗口、托盘、IPC 注册、启动 runtime
- `electron/preload.js`
  - 暴露 `window.localapp2`
- `renderer/index.html`
  - Electron Renderer HTML 入口
- `renderer/src/main.js`
  - 挂载 Vue 应用
- `renderer/src/App.vue`
  - 第一版状态与配置面板
- `renderer/src/styles.css`
  - 第一版桌面工具 UI 样式
- `src/config-store.js`
  - 基于 `app.getPath("userData")` 的 `config.json` 读写
- `src/key-manager.js`
  - 管理密钥路径、读取公钥摘要、导入服务端公钥
- `src/runtime-state-store.js`
  - 维护 UI 订阅的结构化状态
- `src/runtime-adapter.js`
  - 用来把 Electron 壳与同步来的业务代码连接起来
- `src/synced/*`
  - 从 `localapp` 同步过来的业务核心文件，不手改
- `tools/sync-localapp-files.mjs`
  - 执行同步动作
- `tools/localapp-sync.manifest.json`
  - 声明同步源和目标映射

## `localapp2` 的推荐技术栈

推荐：

- Electron
- Vue 3
- Vite
- `electron-builder`

原因：

- 仓库已有 Vue 3 + Vite 经验，沿用成本低
- Electron 适合托盘、窗口、自动启动、安装器
- `electron-builder` 适合输出 Windows 安装包和便携包

推荐新增根脚本：

```json
{
  "workspaces": [
    "localapp",
    "localapp2",
    "webserver/server",
    "webserver/client",
    "packages/agent-core"
  ],
  "scripts": {
    "dev:agent": "npm run dev --workspace localapp",
    "dev:agent2": "npm run dev --workspace localapp2",
    "build:agent2": "npm run build --workspace localapp2",
    "dist:agent2": "npm run dist:win --workspace localapp2"
  }
}
```

这里的 `dev:agent2`、`build:agent2`、`dist:agent2` 是未来新增项，不是当前仓库已存在脚本。

## `localapp2` 的运行模型

### 推荐模型

第一期推荐把 agent runtime 放在 Electron 主进程中运行。

原因：

- 当前 `localapp` 本来就是 Node.js 运行时
- WebSocket、文件系统、命令执行都天然适合主进程
- 先落地比先抽复杂进程隔离更重要

推荐结构：

1. Electron `main`
2. Electron `preload`
3. Vue Renderer
4. `agent-core` runtime

### 后续升级模型

如果后续担心命令执行和窗口生命周期耦合过强，可以把 runtime 移到 `utilityProcess` 或独立子进程，但不建议在第一期就增加这层复杂度。

## `localapp2` 需要提供的功能

### 1. 基础运行能力

- 启动后加载本地配置
- 启动 agent runtime
- 建立到服务端的 WebSocket 长连接
- 展示在线状态、最后连接时间、最后错误
- 支持重连和重启 runtime

### 2. 本地密钥管理

- 一键生成 `auth_private.pem` / `auth_public.pem`
- 展示公钥内容
- 展示公钥指纹
- 复制公钥到剪贴板
- 导入 `webserver_sign_public.pem`
- 校验导入的公钥是否合法

### 3. 配置管理

- 编辑服务端地址
- 编辑 `agentId`
- 编辑 `agentLabel`
- 编辑编码、超时、重连、心跳参数
- 开关“最小化到托盘”
- 开关“开机自启”

### 4. 托盘能力

- 窗口最小化到托盘
- 点击关闭默认隐藏到托盘
- 托盘菜单打开主界面
- 托盘菜单重启连接
- 托盘菜单复制公钥
- 托盘菜单打开日志目录
- 托盘菜单退出程序

### 5. 状态展示

- 当前连接状态
- 当前 `agentId`
- 当前主机名
- 公钥指纹
- 服务端签名公钥状态
- 最近错误
- 最近一条命令状态
- 队列长度

## `localapp2` 的运行时拼装方式

第一阶段不直接把同步过来的文件暴露给 Electron 主进程，而是通过一个 `runtime-adapter.js` 做包裹。

推荐关系：

```text
electron/main.js
  -> src/config-store.js
  -> src/key-manager.js
  -> src/runtime-state-store.js
  -> src/runtime-adapter.js
       -> src/synced/agent-client.js
       -> src/synced/command-runner.js
       -> src/synced/security/secure-command-service.js
       -> localapp2 专用 logger/config 适配层
```

这样做有两个好处：

- 同步文件保持尽量原样，减少 merge 成本
- Electron 宿主专属逻辑都放在 `runtime-adapter.js` 及外围层，边界清晰

## 代码同步机制设计

用户当前的诉求不是马上彻底抽共享包，而是先有一个“能确认哪些文件能共用，并且可以同步过来”的机制。这里推荐采用“清单驱动 + 哈希校验 + 单向同步”的方案。

### 目标

- 明确哪些文件允许从 `localapp` 同步到 `localapp2`
- 让同步过程可重复执行
- 防止误同步不该共用的宿主层代码
- 防止人工修改同步目标文件后被悄悄覆盖

### 推荐目录

```text
localapp2/tools/localapp-sync.manifest.json
localapp2/tools/sync-localapp-files.mjs
localapp2/src/synced/
```

### 推荐同步方向

仅允许：

```text
localapp -> localapp2/src/synced
```

不要允许反向同步，也不要允许任意目录互相覆盖。

### 推荐 manifest 结构

```json
{
  "version": 1,
  "entries": [
    {
      "source": "../localapp/src/agent-client.js",
      "target": "../localapp2/src/synced/agent-client.js"
    },
    {
      "source": "../localapp/src/command-runner.js",
      "target": "../localapp2/src/synced/command-runner.js"
    },
    {
      "source": "../localapp/src/security/secure-command-service.js",
      "target": "../localapp2/src/synced/security/secure-command-service.js"
    }
  ]
}
```

最终路径写法可以根据脚本实际执行目录调整，但原则应保持不变：

- 只允许显式列出的文件被同步
- 不支持隐式目录整包复制

### 同步脚本职责

`sync-localapp-files.mjs` 建议支持：

- `--check`
  - 检查目标文件是否与源文件一致
- `--write`
  - 执行实际覆盖同步
- `--manifest <path>`
  - 指定 manifest

### 同步规则

建议同步脚本遵守这些规则：

1. 读取 manifest 中的源/目标映射
2. 校验源文件都在 `localapp/src` 范围内
3. 校验目标文件都在 `localapp2/src/synced` 范围内
4. 比较内容哈希
5. 如目标文件已被手工修改且与源不一致，默认报错并停止
6. 只有显式传入 `--write` 时才允许覆盖
7. 同步后的目标文件头部写入生成标记

### 目标文件头部建议

同步生成的文件顶部建议加一段标记注释，例如：

```js
// Synced from localapp/src/agent-client.js
// Do not edit this file directly.
// Run: node localapp2/tools/sync-localapp-files.mjs --write
```

这样可以明确告诉后续维护者：

- 这个文件来自 `localapp`
- 不要直接在 `localapp2/src/synced` 下手改
- 正确入口是改源文件再同步

### 推荐 npm scripts

未来 `localapp2/package.json` 可加入：

```json
{
  "scripts": {
    "sync:localapp": "node tools/sync-localapp-files.mjs --write",
    "check:localapp-sync": "node tools/sync-localapp-files.mjs --check"
  }
}
```

根目录也可以增加：

```json
{
  "scripts": {
    "sync:agent2": "npm run sync:localapp --workspace localapp2",
    "check:agent2-sync": "npm run check:localapp-sync --workspace localapp2"
  }
}
```

## 同步机制的边界

这个同步机制只是第一阶段的工程折中，不是最终架构。

它适合的场景：

- 先快速确认 `localapp2` 框架是否能跑
- 先验证哪些业务文件可以稳定复用
- 暂时不想一次性做共享包重构

它不适合的场景：

- 长期演进几十个源文件
- 经常双向修改两端逻辑
- 需要细粒度版本管理和包发布

一旦确认这三类文件长期稳定共用：

- `agent-client.js`
- `command-runner.js`
- `secure-command-service.js`

就应该尽快把它们从“同步机制”迁移为真正的 `packages/agent-core` 共享包。

## `localapp2` 第一版的非目标

第一版不建议做这些事情：

- 不把现有 `webserver/client` 的远程控制台整体搬进 Electron
- 不在本地桌面端实现完整登录、用户管理、命令时间线后台系统
- 不让渲染进程直接拿到私钥内容
- 不在 Renderer 中直接执行命令
- 不和 `localapp` 共享同一份配置文件

更现实的第一版边界是：

- `localapp2` 负责本地 agent 配置与状态
- `auth_code` 上传仍由现有 Web 控制台完成
- 远程命令下发仍由现有 Web 控制台完成

这样职责最清晰，也不会让桌面端膨胀成第二套控制台系统。

## 配置与数据落盘设计

### `localapp`

继续沿用：

- `.env`
- 相对路径 `./keys`
- 相对路径 `./logs`
- 适配 `pm2`

### `localapp2`

必须改为用户目录持久化，不应写入安装目录。

推荐目录：

```text
%APPDATA%/RemoteLocalApp2/
  config.json
  keys/
    auth_private.pem
    auth_public.pem
    webserver_sign_public.pem
  logs/
    agent.log
    command.log
```

推荐配置优先级：

1. `config.json`
2. 开发模式 `.env`
3. 默认值

推荐 `config.json`：

```json
{
  "serverWsUrl": "ws://localhost:3100/ws/agent",
  "agentId": "office-pc-01-desktop",
  "agentLabel": "Office PC Desktop",
  "agentSharedToken": "",
  "heartbeatIntervalMs": 15000,
  "reconnectIntervalMs": 5000,
  "commandTimeoutMs": 120000,
  "maxBufferBytes": 1048576,
  "windowsOutputEncoding": "cp936",
  "authPrivateKeyPath": "keys/auth_private.pem",
  "webserverSignPublicKeyPath": "keys/webserver_sign_public.pem",
  "minimizeToTray": true,
  "launchOnStartup": false
}
```

## 密钥与身份设计

### 关键原则

- `localapp` 和 `localapp2` 各自生成自己的 `auth_public.pem`
- Web 端应分别为两个 `agentId` 录入两条 `auth_code`
- `webserver_sign_public.pem` 可以来自同一个服务端公钥
- 私钥只保存在各自客户端本地

### 推荐做法

`localapp2` 不直接 shell 调用现有 `scripts/generate-rsa-keypair.js`，而是：

1. 把该脚本的核心逻辑抽成可复用模块
2. CLI 脚本继续作为薄封装
3. `localapp2` 主进程直接调用公共模块生成密钥

这样能避免：

- Electron 内部再套一层 shell
- 路径处理和错误输出难以控制
- 后续 CLI 和 GUI 的生成逻辑分叉

## `localapp2` 的 IPC 设计

Renderer 只能通过 `preload` 调用受控 API。

建议 API：

```js
window.localapp2 = {
  getSnapshot(),
  subscribeRuntime(listener),
  getConfig(),
  updateConfig(payload),
  restartRuntime(),
  generateLocalKeyPair(options),
  importWebserverPublicKey(input),
  getKeySummary(),
  copyAuthPublicKey(),
  openLogDirectory(),
  openKeyDirectory(),
  showMainWindow(),
  hideToTray()
};
```

推荐 IPC 分类：

- 查询类：`runtime:get-snapshot`、`config:get`、`keys:get-summary`
- 订阅类：`runtime:changed`、`logs:appended`
- 动作类：`config:update`、`runtime:restart`、`rsa:generate-localapp2`、`rsa:import-webserver-public-key`

## `localapp2` 的界面建议

建议拆成 4 个一级页面：

### 1. 概览

- 在线状态
- `agentId`
- 主机名
- 最近连接时间
- 最近错误
- 最近命令状态

### 2. 安全与密钥

- 当前公钥指纹
- 公钥内容预览
- 复制公钥
- 重新生成密钥
- 导入服务端签名公钥

### 3. 配置

- 服务端地址
- `agentId`
- `agentLabel`
- 心跳/重连间隔
- 超时和编码
- 启动到托盘
- 开机自启

### 4. 日志

- 最近日志预览
- 打开日志目录
- 打开密钥目录

## 安全边界

Electron 端必须坚持这些限制：

- `nodeIntegration: false`
- `contextIsolation: true`
- 渲染进程只通过 `preload` 调 IPC
- 私钥内容不直接发给 Renderer
- Renderer 不暴露任意命令执行能力

否则桌面端会比当前纯 Node agent 更危险。

## 与现有服务端的兼容性

`localapp2` 应继续兼容当前服务端，不要求修改协议。

当前服务端已经依赖：

- `command.execute.secure`
- `user_auth_codes`
- 基于 `agentId` 的在线状态注册

所以 `localapp2` 只需要继续遵守现有协议：

- 接收 `command.execute.secure`
- 验签
- 解密
- 校验 `agentId`
- 校验 `expiresAt`
- 校验 `nonce`
- 回传 `command.started` / `command.finished`

注意：

- `localapp2` 不是一个“特殊协议客户端”
- 它只是另一种承载同样 agent 能力的宿主壳

## 发布与安装建议

推荐使用 `electron-builder` 产出：

- `nsis` 安装包
- 便携版 zip 或 portable

建议配置：

- `appId`: `com.remote.localapp2`
- `productName`: `Remote LocalApp2`
- `artifactName`: `RemoteLocalApp2-${version}.${ext}`

Windows 侧还需要准备：

- 托盘图标 `.ico`
- 应用图标 `.ico`
- 安装器信息

## `localapp` 的 pm2 方向

`localapp` 继续作为后台 agent 时，推荐保留极简形态。

后续可新增：

- `localapp/ecosystem.config.cjs`
- 根脚本 `start:agent:pm2`

例如：

```js
module.exports = {
  apps: [
    {
      name: "localapp",
      script: "src/index.js",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      watch: false
    }
  ]
};
```

这里的关键点是：

- `pm2` 只管理 `localapp`
- Electron 不进入 `pm2`
- 两条客户端产品线各自独立发布

## 推荐实施顺序

### 阶段 1：稳定 `localapp` 身份

目标：

- 确认 `localapp` 继续保留为 pm2 版
- 不在 `localapp` 中引入 Electron 依赖
- 明确 `agentId` 命名规范和密钥隔离规则

### 阶段 2：抽公共 `agent-core`

目标：

- 从当前 `localapp/src` 中抽出可复用 runtime
- 不改变协议行为
- 让 `localapp` 变成薄包装层

输出：

- `packages/agent-core`
- `localapp` 继续可用

### 阶段 3：创建 `localapp2`

目标：

- 新建 Electron workspace
- 跑通主进程、托盘、preload、Renderer
- 跑通本地配置和状态展示

输出：

- `localapp2/package.json`
- `localapp2/electron/main.js`
- `localapp2/electron/preload.js`
- `localapp2/renderer/*`

### 阶段 4：接入密钥管理

目标：

- GUI 生成密钥
- 复制公钥
- 导入服务端签名公钥
- 校验指纹和状态

### 阶段 5：打包与 Windows 验证

目标：

- 输出安装包
- 验证 `userData` 目录写入
- 验证托盘常驻
- 验证开机自启
- 验证命令链路可用

## 风险与注意事项

### 风险 1：`agentId` 冲突

这是最容易踩中的坑。

如果 `localapp` 和 `localapp2` 使用同一个 `agentId`，服务端会把它们视为同一台 agent 的不同连接，在线状态和命令派发都会混乱。

### 风险 2：直接复制 `localapp` 代码

短期快，长期会变成两套 agent 实现并行维护。

### 风险 3：Electron 写安装目录

如果 `localapp2` 仍然沿用相对路径写 `keys/`、`logs/`，打包后极容易失败。

### 风险 4：把桌面端做成第二个 Web 控制台

这样会导致桌面端范围失控，第一期很难落地。

### 风险 5：私钥暴露到 Renderer

这会把桌面端安全边界直接打穿。

## 最终建议

从当前项目整体情况看，最合理的方案不是“Electron 化 `localapp`”，而是：

1. 保留 `localapp`，继续面向 `pm2`
2. 新增 `localapp2`，面向 Windows 桌面工具
3. 抽公共 `agent-core`，避免两套 runtime 漂移
4. 强制隔离 `agentId`、配置、密钥和日志目录
5. `localapp2` 第一版只做本地 agent 管理，不重做现有 Web 控制台

如果按这个方向推进，最终会得到两种清晰的客户端形态：

- `localapp`：适合无人值守、pm2 托管、后台部署
- `localapp2`：适合人工安装、图形配置、托盘常驻、Windows 使用

这两者共享协议和核心能力，但不共享宿主形态。
