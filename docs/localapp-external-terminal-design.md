# localapp 双通道执行改造方案

## 1. 说明

这份文档基于当前仓库里的 `localapp` 实现来分析。

- 仓库中没有 `localpp` 目录，当前实际存在的是 `localapp`
- 以下结论均以 `localapp/src`、`webserver/server/src`、`shared/secure-command.mjs` 为准
- 这里说的“外部指令”是：**来自 `webserver` 的指令**
- 本次方案不是替换现有 `command` 链路，而是 **保留旧能力，再新增一条 PTY 流式会话能力**

## 2. 目标

目标不是把当前系统从一种模式“升级替换”为另一种模式，而是做成双通道：

### 2.1 旧通道继续保留

继续保留现有快速命令模式：

- 浏览器通过 `webserver /api/commands` 提交 `command`
- `webserver` 继续发送 `command.execute.secure`
- `localapp` 继续用当前快速执行方式处理
- 结果继续通过 `command.started` / `command.finished` 返回

这个通道的特点是：

- 简单
- 快
- 适合一次性命令
- 适合“提交后等待完整结果返回”

### 2.2 新通道单独新增

新增终端会话模式：

- 浏览器通过 `webserver` 新接口创建会话
- `webserver` 下发“会话创建 / 输入 / 终止”类消息
- `localapp` 用 `spawn + PTY` 管理会话
- 输出通过流式事件持续回传

这个通道的特点是：

- 适合 Claude Code / Codex 这类终端型 CLI
- 适合长任务
- 适合流式输出
- 适合多轮输入

### 2.3 增加本地调试入口

除了生产主入口之外，`localapp` 还需要额外增加一个本地监听端口，专门给 mock-client 调试使用。

这个入口的定位是：

- 只用于本地开发和联调
- 方便直接测试终端调用能力
- 避免每次都必须同时启动 `webserver`、前端、数据库再联调
- 复用同一套内部执行逻辑，而不是再做一套独立执行实现

这个入口的边界是：

- 默认关闭
- 只监听 `127.0.0.1`
- 仅用于测试，不作为生产主控制面
- 仍然要有最基本的本地鉴权，例如本地 token

## 3. 当前实现现状

### 3.1 现有入口已经在 `webserver`

`webserver/server/src/index.js` 当前暴露：

- `/api/commands`
- `/api/agents`
- `/api/auth-codes`
- `/ws/agent`
- `/ws/browser`

当前真实调用链路是：

`浏览器 -> webserver /api/commands -> 安全封装 -> WebSocket -> localapp`

所以生产主入口不需要改成 `localapp localhost API`，但为了 mock-client 本地联调，`localapp` 仍然建议额外提供一个仅限本机访问的调试端口。

### 3.2 现有安全命令链路已经可用

当前已经有：

- `webserver` 端安全封装
- `localapp` 端验签和解密
- `agentId` 校验
- `expiresAt` 校验
- `nonce` 重放保护

这部分应该继续保留。

### 3.3 现有快速命令执行链路已经可用

当前 `localapp` 的快速命令链路是：

- 接收 `command.execute.secure`
- 放入 `commandQueue`
- 使用 `command-runner.js`
- 通过 `exec()` 执行
- 回传 `command.started` / `command.finished`

这条链路本身不该被删除。

### 3.4 当前缺的是“会话型终端能力”

当前没有：

- PTY 会话
- 会话创建
- 会话输入
- 流式输出事件
- 会话终止
- 会话状态管理

所以真正要新增的是这一块，而不是替换原有命令链路。

## 4. 推荐总方向

推荐方向很简单：

1. 保留现有 `command` 快速通道
2. 新增 `terminal session` 会话通道
3. 两条通道共用同一套安全链路
4. 两条通道在 `localapp` 内部共存，但使用不同执行器
5. 额外增加一个 `local debug port`，专供 mock-client 直接打到 `localapp`

整体结构应当是：

### 4.1 快速命令通道

`浏览器 -> /api/commands -> command.execute.secure -> localapp CommandRunner(exec) -> command.finished`

### 4.2 终端会话通道

`浏览器 -> /api/terminal-sessions -> *.session.*.secure -> localapp PtySessionRunner(node-pty) -> 流式 session 事件`

### 4.3 本地调试通道

`mock-client -> localapp 127.0.0.1:<debug-port> -> 同一套 CommandRunner / PtySessionRunner -> 本地结果或流式事件`

这个通道的目标不是替代 `webserver`，而是：

- 本地快速联调
- 单机测试
- 开发期间验证终端能力和协议映射

## 5. 为什么要保留旧通道

你现在的要求是对的：旧通道有明确价值，不能为了支持模型 CLI 把它做复杂。

旧通道适合：

- `ipconfig /all`
- `git status`
- `dir`
- `ping`
- 一次性脚本命令
- 需要完整 stdout/stderr 后统一返回的场景

它的优势是：

- 改动面小
- 回归风险低
- 运维心智简单
- 与当前前端和日志模型兼容

所以旧通道建议：

- 外部接口保留
- 消息类型保留
- 结果事件保留
- UI 展示保留

## 6. 为什么要新增会话通道

Claude Code、Codex、以及类似终端型 LLM CLI 的问题在于，它们通常不是“一条命令跑完就结束”的工具。

这类工具经常具备这些特点：

- 默认就是交互式
- 输出是流式的
- 运行时间长
- 可能依赖 TTY
- 可能要持续写入 stdin

所以它们不适合直接塞进现有的：

- `exec()`
- `command.finished`
- 单 FIFO 串行队列

更合理的做法是：

- 不碰旧通道的语义
- 单独新增会话通道

## 7. 协议设计建议

### 7.1 旧协议保持不动

下面这些建议保持原样：

- `command.execute.secure`
- `command.started`
- `command.finished`
- `/api/commands`
- `CommandStore`

也就是说：

- 旧命令继续是 `command string`
- 旧结果继续是一次性完整结果

### 7.2 新协议单独增加

建议新增一组会话型消息，例如：

- `terminal.session.create.secure`
- `terminal.session.input.secure`
- `terminal.session.terminate.secure`

回传事件建议新增：

- `terminal.session.created`
- `terminal.session.output`
- `terminal.session.updated`
- `terminal.session.closed`
- `terminal.session.error`

这样做的好处是：

- 旧协议完全不受影响
- 新协议语义清楚
- 浏览器端也容易区分展示

### 7.4 本地调试端口不需要复刻安全封装协议

这个本地调试端口的目标是 mock-client 联调，不是生产远控，因此不需要完整复刻：

- `auth_code` 加密
- `webserver` 签名
- WebSocket 安全封装

但它也不应该直接另起一套独立业务逻辑。

更合理的做法是：

- `webserver` 链路负责“安全封装 -> 解密 -> 提交内部执行请求”
- 本地调试端口直接提交“解密后的内部执行请求”
- 两条入口最后汇合到同一个内部处理器

也就是说，本地调试端口复用的是：

- 相同的命令执行器
- 相同的 PTY 会话管理器
- 相同的参数校验和 profile 解析

而不是复用生产安全封装本身。

### 7.3 新会话消息建议结构

#### 创建会话

```json
{
  "requestId": "uuid",
  "agentId": "office-pc-01",
  "sessionType": "llm_cli",
  "profile": "claude_code_session",
  "payload": {
    "cwd": "C:\\project\\remote-client",
    "env": {}
  },
  "createdAt": "2026-04-17T10:00:00.000Z",
  "issuedAt": "2026-04-17T10:00:02.000Z",
  "expiresAt": "2026-04-17T10:01:02.000Z",
  "nonce": "uuid"
}
```

#### 向会话写入输入

```json
{
  "requestId": "uuid",
  "agentId": "office-pc-01",
  "sessionId": "session-uuid",
  "payload": {
    "input": "继续分析 auth 模块\\n"
  },
  "createdAt": "2026-04-17T10:00:00.000Z",
  "issuedAt": "2026-04-17T10:00:02.000Z",
  "expiresAt": "2026-04-17T10:01:02.000Z",
  "nonce": "uuid"
}
```

#### 输出事件

```json
{
  "sessionId": "session-uuid",
  "agentId": "office-pc-01",
  "stream": "stdout",
  "chunk": "Analyzing project structure...\r\n",
  "seq": 12,
  "sentAt": "2026-04-17T10:00:05.000Z"
}
```

#### 会话关闭事件

```json
{
  "sessionId": "session-uuid",
  "agentId": "office-pc-01",
  "status": "completed",
  "exitCode": 0,
  "reason": "",
  "closedAt": "2026-04-17T10:10:00.000Z"
}
```

## 8. `webserver` 需要怎么改

### 8.1 保留 `/api/commands`

当前 [webserver/server/src/index.js:457](/C:/project/remote-client/webserver/server/src/index.js#L457) 的 `/api/commands` 继续保留。

这条接口保持现状：

- 请求体还是 `agentId + command`
- 仍然服务于快速命令执行
- 不承载交互会话语义

### 8.2 新增会话相关接口

建议新增一组接口，例如：

- `POST /api/terminal-sessions`
- `POST /api/terminal-sessions/:sessionId/input`
- `POST /api/terminal-sessions/:sessionId/terminate`
- `GET /api/terminal-sessions`
- `GET /api/terminal-sessions/:sessionId`

如果想更聚焦模型工具，也可以叫：

- `/api/llm-sessions`

但从长期看，`terminal-sessions` 更通用。

### 8.3 保留 `CommandStore`，新增 `TerminalSessionStore`

当前 [webserver/server/src/state/command-store.js:3](/C:/project/remote-client/webserver/server/src/state/command-store.js#L3) 继续保留给旧命令用。

建议新增：

- `webserver/server/src/state/terminal-session-store.js`

专门记录：

- `sessionId`
- `agentId`
- `profile`
- `status`
- `createdAt`
- `lastOutputAt`
- `startedAt`
- `closedAt`
- `exitCode`
- `error`

不要强行把会话状态塞进现有 `CommandStore`。

### 8.4 保留 `dispatchCommand()`，新增 `dispatchTerminalSession*()`

当前 [webserver/server/src/index.js:806](/C:/project/remote-client/webserver/server/src/index.js#L806) 的 `dispatchCommand()` 继续保留给旧通道用。

建议新增：

- `dispatchTerminalSessionCreate()`
- `dispatchTerminalSessionInput()`
- `dispatchTerminalSessionTerminate()`

### 8.5 浏览器端要做成两个面板

更合理的 UI 是：

- 旧的“命令执行”面板继续保留
- 新增“终端会话”面板

不要把一次性命令和交互会话强行混在同一个卡片模型里。

## 9. `localapp` 需要怎么改

### 9.1 保留现有 `CommandRunner`

当前 [localapp/src/command-runner.js:5](/C:/project/remote-client/localapp/src/command-runner.js#L5) 继续保留。

它继续负责：

- 一次性命令
- 快速返回结果
- `command.finished` 结果模型

### 9.2 保留现有 `commandQueue`

当前 `localapp/src/agent-client.js` 里的 `commandQueue` 继续保留给旧命令使用。

不要把旧命令和会话任务混进同一个串行队列。

### 9.3 新增 PTY 会话管理器

建议新增：

- `localapp/src/runtime/pty-session-manager.js`
- `localapp/src/runtime/runners/terminal-session-runner.js`
- `localapp/src/runtime/session-store.js`

它们负责：

- 创建 PTY 会话
- 保存会话句柄
- 向会话写入输入
- 读取流式输出
- 终止和回收会话

### 9.4 `AgentClient` 同时处理两类消息

建议把 `AgentClient` 改成：

- 继续处理 `command.execute.secure`
- 新增处理 `terminal.session.create.secure`
- 新增处理 `terminal.session.input.secure`
- 新增处理 `terminal.session.terminate.secure`

也就是说：

- 旧逻辑不删
- 新逻辑并挂

### 9.5 结果回传也分两类

`localapp` 的回传建议分开：

#### 旧命令回传

继续保留：

- `command.started`
- `command.finished`

#### 新会话回传

新增：

- `terminal.session.created`
- `terminal.session.output`
- `terminal.session.updated`
- `terminal.session.closed`

### 9.6 `localapp` 额外增加本地调试服务

建议新增一个轻量本地服务，例如：

- `localapp/src/local-debug-server.js`

这个服务只负责两件事：

- 接收 mock-client 的本地测试请求
- 把请求转给和生产链路相同的内部执行层

建议提供的最小接口：

- `GET /api/debug/health`
- `POST /api/debug/commands`
- `POST /api/debug/terminal-sessions`
- `POST /api/debug/terminal-sessions/:sessionId/input`
- `POST /api/debug/terminal-sessions/:sessionId/terminate`

其中：

- `/api/debug/commands` 直接测试旧的快速命令通道
- `/api/debug/terminal-sessions*` 直接测试新的 PTY 会话通道

这样 mock-client 就可以直接验证：

- 本地命令执行
- 本地终端会话创建
- 流式输出
- 输入回写
- 会话终止

而不需要每次都启动整套 `webserver + client + db`。

## 10. 执行器设计建议

### 10.1 快速命令执行器

旧通道继续使用当前模式即可：

- `CommandRunner`
- `exec()`
- 一次性收集 `stdout` / `stderr`
- 一次性返回

这一部分不建议为了“统一”而强行重构。

### 10.2 会话执行器

新通道建议使用：

- `node-pty`

原因是：

- 本质上就是 `spawn + PTY / ConPTY` 这一类终端进程模型
- Windows 下更适合终端交互
- 很多 CLI 需要 TTY
- 支持流式输出
- 支持持续写入 stdin

### 10.3 为什么不是只用 `spawn()`

`spawn()` 适合很多流式任务，但如果你的目标明确包含：

- Claude Code 交互模式
- Codex 交互模式
- 类似 shell 的会话能力

那 PTY 更稳妥。

所以建议是：

- 旧快速命令：继续 `exec()`
- 新会话能力：使用 `node-pty`

## 11. Claude Code / Codex 的接入建议

### 11.1 Claude Code

我在当前机器上做了快速检查，时间点是 `2026-04-17`。

结果如下：

- 找到了 `claude.exe`
- 路径是 `C:\\Users\\defaultuser0.DESKTOP-1LG9IK4\\.local\\bin\\claude.exe`
- `claude --version` 返回 `2.1.81 (Claude Code)`
- `claude --help` 显示默认行为是交互式 session

这很适合放进新会话通道。

### 11.2 Codex

当前机器上没有找到 `codex` 可执行文件，所以第一版不要把 Codex 参数模板写死。

更合理的做法是：

- 先把会话框架做好
- 再通过 profile 适配具体工具

## 12. Profile 配置建议

旧命令通道可以继续保留原始 `command string`。

新会话通道建议引入 profile，例如：

- `localapp/config/tool-profiles.json`

示例：

```json
{
  "profiles": {
    "claude_code_session": {
      "runner": "pty",
      "command": "claude",
      "argsTemplate": [],
      "cwdPolicy": "allowlist",
      "envAllowlist": [
        "ANTHROPIC_API_KEY",
        "HTTP_PROXY",
        "HTTPS_PROXY"
      ],
      "idleTimeoutMs": 1800000
    }
  }
}
```

这样可以做到：

- 旧命令还是快命令
- 新会话用 profile 约束
- 不把危险参数直接暴露到浏览器

## 13. 安全要求

### 13.1 继续复用现有安全链路

继续保留：

- `auth_code` 加密
- `webserver` 签名
- `localapp` 验签
- `expiresAt`
- `nonce`

### 13.2 旧通道安全边界不变

旧通道继续沿用当前规则：

- `command.execute.secure`
- 快速执行
- 完整结果返回

### 13.3 新会话通道要额外限制

建议限制：

- 最大会话数
- 单会话最大空闲时长
- 允许的 `cwd`
- 允许的环境变量
- 允许的工具 profile

### 13.5 本地调试端口也要有边界

虽然它只是本地测试入口，但也不能裸奔。

建议最少限制：

- 只监听 `127.0.0.1`
- 默认关闭，通过配置显式开启
- 需要本地 token，例如 `Authorization: Bearer <LOCAL_DEBUG_TOKEN>`
- 不允许绕过 profile / cwd / env 的限制
- 所有调试调用都写日志

### 13.4 会话进程必须可回收

必须考虑：

- agent 断线时如何处理会话
- 浏览器关闭时是否保留会话
- 会话空闲多久自动关闭
- PTY 子进程异常退出后的清理

## 14. 建议的代码改造清单

### 14.1 `localapp`

建议保留：

- [localapp/src/command-runner.js](/C:/project/remote-client/localapp/src/command-runner.js)
- [localapp/src/agent-client.js](/C:/project/remote-client/localapp/src/agent-client.js)

建议新增：

- `localapp/src/runtime/pty-session-manager.js`
- `localapp/src/runtime/runners/terminal-session-runner.js`
- `localapp/src/runtime/session-store.js`
- `localapp/config/tool-profiles.json`
- `localapp/src/local-debug-server.js`

建议新增依赖：

- `node-pty`
- `zod` 或 `ajv`

建议新增配置：

- `LOCAL_DEBUG_SERVER_ENABLED`
- `LOCAL_DEBUG_SERVER_HOST`
- `LOCAL_DEBUG_SERVER_PORT`
- `LOCAL_DEBUG_TOKEN`

### 14.2 `webserver/server`

建议保留：

- [webserver/server/src/index.js](/C:/project/remote-client/webserver/server/src/index.js)
- [webserver/server/src/state/command-store.js](/C:/project/remote-client/webserver/server/src/state/command-store.js)

建议新增：

- `webserver/server/src/state/terminal-session-store.js`
- `webserver/server/src/security/secure-terminal-session-service.js`

或者更合理一点：

- 把现有 secure command service 抽成更通用的 secure envelope service
- 但保持旧 command 入口兼容

### 14.3 `webserver/client`

建议：

- 保留现有命令面板
- 新增终端会话面板
- 新增流式输出区域
- 新增输入框和终止按钮

## 15. 推荐的分阶段落地方式

### 阶段 1：只加会话骨架，不动旧命令

目标：

- `/api/commands` 不变
- `command.execute.secure` 不变
- `command.finished` 不变
- 新增会话接口和会话协议
- 新增本地调试端口，供 mock-client 直连测试

建议这阶段做：

- 新增 `/api/terminal-sessions`
- 新增会话 store
- `localapp` 引入 `node-pty`
- 新增 `terminal.session.create.secure`
- 新增 `terminal.session.output`
- 新增 `local-debug-server`

### 阶段 2：支持输入和终止

目标：

- 浏览器可以继续向会话输入
- 浏览器可以主动终止会话

建议这阶段做：

- `terminal.session.input.secure`
- `terminal.session.terminate.secure`
- `terminal.session.closed`

### 阶段 3：接入具体模型工具

目标：

- 接入 Claude Code
- 接入 Codex
- 引入 profile 控制

## 16. 最小验收标准

### 16.1 旧通道验收

现有下面这条链路必须保持可用：

- 浏览器调用 `webserver /api/commands`
- `webserver` 生成 `command.execute.secure`
- `localapp` 验签、解密、执行
- 最终返回 `command.finished`

### 16.2 新通道验收

浏览器创建一个终端会话后，系统应能：

- `webserver` 安全下发创建会话消息
- `localapp` 创建 PTY 会话
- 浏览器持续看到输出
- 浏览器可继续输入
- 会话可被主动终止

## 17. 不建议的做法

### 17.1 不要为了支持模型 CLI 去替换旧命令通道

旧通道本身有明确价值，应该保留。

### 17.2 不要把会话语义塞进 `command.finished`

一次性返回和流式会话是两种完全不同的模型。

### 17.3 不要把旧命令队列和 PTY 会话混成一个调度器

它们的生命周期完全不同。

### 17.4 不要把所有模型工具都当成普通命令字符串

会话型工具更适合走 profile + PTY。

## 18. 最终建议

如果只问一句“要怎么改”，答案是：

1. 保留现有 `command + command.finished` 快速通道
2. 追加一套 `terminal session + 流式事件` 新通道
3. `localapp` 里保留旧 `CommandRunner(exec)`，再新增 `PtySessionRunner(node-pty)`
4. `webserver` 里保留 `/api/commands`，再新增会话接口和会话状态管理
5. `localapp` 额外增加一个仅用于 mock-client 联调的本地监听端口
6. 快速命令继续用于一次性任务，Claude Code / Codex 这类终端型工具优先走新会话通道

按这个方向改，系统会变成：

- 旧通道负责“快命令 + 快返回”
- 新通道负责“终端会话 + 流式输出 + 多轮输入”
- 本地调试端口负责“单机 mock-client 直连联调”

两者共存，而不是相互替换。
