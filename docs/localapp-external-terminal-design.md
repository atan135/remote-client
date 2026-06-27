# localapp 双通道远程执行架构说明

更新时间：2026-06-28

## 说明

这份文档以当前仓库里的真实实现为准，描述 `localapp` 现在已经落地的“双通道执行”能力，而不是早期“待新增会话能力”的方案稿。

这里的“双通道”指：

- 一次性命令通道
- 交互式终端会话通道

两条通道当前已经共存，并且共用同一套安全链路。

## 核心结论

当前项目已经不是“只有快速命令，没有会话终端”的状态，而是：

1. 保留了原有一次性命令执行能力
2. 已新增交互式 PTY 终端会话能力
3. 已新增本地调试入口
4. 已新增远程文本文件读取与保存能力
5. 已支持 `Claude Code` / `Codex` 这类 profile 驱动的终端会话

## 当前能力概览

## 1. 一次性命令通道

当前链路：

`浏览器 -> /api/commands -> command.execute.secure -> localapp -> command.started / command.finished`

特点：

- 串行执行
- 快速返回
- 适合一次性运维命令
- 结果以完整 `stdout` / `stderr` 结束态回传

典型场景：

- `hostname`
- `whoami`
- `ipconfig /all`
- `git status`

## 2. 交互式终端会话通道

当前链路：

`浏览器 -> /api/terminal-sessions* -> terminal.session.*.secure -> localapp PTY -> 流式输出`

当前已实现：

- 创建会话
- 向会话写入输入
- 终端 resize
- 终止会话
- 流式输出回传
- 关闭态回传
- 会话摘要与 `final_text` 提取

这条链路更适合：

- 长任务
- 需要持续 stdin/stdout 的 CLI
- 依赖 TTY 的工具
- Claude Code / Codex 这类终端型 AI CLI

## 3. 本地调试入口

当前 `localapp` 已实现本地调试 HTTP 服务，默认关闭。

当前已实现接口：

- `GET /api/debug/health`
- `POST /api/debug/commands`
- `GET /api/debug/terminal-sessions`
- `POST /api/debug/terminal-sessions`
- `GET /api/debug/terminal-sessions/:sessionId`
- `POST /api/debug/terminal-sessions/:sessionId/input`
- `POST /api/debug/terminal-sessions/:sessionId/terminate`

边界：

- 默认关闭
- 只监听本机
- 需要 `LOCAL_DEBUG_TOKEN`
- 仅用于开发联调

## 4. 远程文本文件读取与保存

当前还新增了独立的远程文本文件能力。它复用安全 envelope，但不是通过终端命令读写文件，也不依赖 PTY 会话存在：

`浏览器 -> /api/remote-files/read -> file.read.secure -> localapp -> file.read.completed`

`浏览器 -> /api/remote-files/write -> file.write.secure -> localapp -> file.write.completed`

当前支持：

- 文本文件预览与保存
- `sessionId` 只是可选上下文，`/api/remote-files/read` 允许不传 `sessionId`
- 绝对路径无需 `baseCwd`
- 相对路径带活动 `sessionId` 时，agent 会优先向 PTY 会话探测当前目录作为实时基准目录；探测失败时再回退请求 `baseCwd`
- 如果相对文件名未精确命中，agent 会在基准目录下做受限文件名模糊搜索；只有唯一匹配时才打开
- `localapp` 使用 `fs/stat/read/write` 读写文件，不通过 shell、PTY 或终端命令读写
- 文件大小截断
- 常见编码识别
- `.txt` 和其他普通文本默认进入纯文本编辑；Markdown 文件默认预览，并可切换纯文本查看或编辑
- 保存成功后返回新的 `modifiedAt`、`totalBytes`、`bytesWritten` 等元数据，保存失败通过 `file.write.error` 回传

注意：自动获取当前目录只用于解析路径，文件内容读写仍不通过终端命令。Windows `localapp` 也不会把 `/c/...` 这类 Git Bash / POSIX 风格路径自动转换为 `C:\...`。

远程文件保存边界：

- 保存能力必须复用安全 envelope 和 `file.write.secure`，不能恢复明文派发。
- 保存必须由 `localapp` 使用文件系统 API 写入，不能通过 shell、PTY 或终端命令写文件。
- `.txt` 支持纯文本直接编辑；`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn` 支持 Markdown 预览和纯文本编辑切换，保存时写回纯文本。
- 读取结果已截断、`resolvedPath` 为空、读取失败、二进制文件、路径解析冲突、远程文件已变化冲突时不允许保存。
- 写入前必须校验目标文件当前 `mtime` 和 `size` 是否分别匹配读取时的 `modifiedAt` 和 `totalBytes`；不匹配时拒绝覆盖并要求用户重新打开文件。
- `file.write.secure` 解密载荷包含 `requestId`、`agentId`、`sessionId`、`filePath`、`resolvedPath`、`baseCwd`、`content`、`encoding`、`expectedModifiedAt`、`expectedTotalBytes`、`issuedAt`、`expiresAt`、`nonce`。
- 写入结果通过 `file.write.completed` 或 `file.write.error` 回传；日志和错误响应不得输出完整大段文件内容。

## 当前实现状态

## 1. `webserver` 侧已落地

当前服务端真实存在：

- `/api/commands`
- `/api/terminal-sessions`
- `/api/terminal-sessions/:sessionId/input`
- `/api/terminal-sessions/:sessionId/terminate`
- `/api/terminal-sessions/:sessionId`
- `DELETE /api/terminal-sessions/:sessionId`
- `/api/remote-files/read`
- `/api/remote-files/write`

当前服务端也已实现：

- `CommandStore`
- `TerminalSessionStore`
- 终端会话历史持久化
- 输入 turn 与 `final_text` 摘要
- agent 重连后的活动会话同步

## 2. `localapp` 侧已落地

当前 `localapp` 已实现：

- `ExecutionGateway`
- `PtySessionManager`
- `TerminalSessionRunner(node-pty)`
- `SessionStore`
- `ToolProfileRegistry`
- `LocalDebugServer`

也就是说，文档中曾经提到的这些“建议新增模块”，现在大多已经存在于源码中。

## 3. 浏览器端已落地

当前前端不只是“有个终端会话入口”，而是已经做了完整 UI：

- 一次性命令面板
- 交互式会话面板
- 会话列表
- 会话详情
- 终端输入框
- 原始终端输出区
- `final_text` 展示区
- 文件预览区

## 当前消息协议

## 1. server -> agent

当前已实现：

- `agent.pong`
- `command.execute.secure`
- `terminal.session.create.secure`
- `terminal.session.input.secure`
- `terminal.session.resize.secure`
- `terminal.session.terminate.secure`
- `file.read.secure`
- `file.write.secure`

## 2. agent -> server

当前已实现：

- `agent.register`
- `agent.heartbeat`
- `agent.ping`
- `command.started`
- `command.finished`
- `terminal.session.created`
- `terminal.session.resized`
- `terminal.session.output`
- `terminal.session.closed`
- `terminal.session.error`
- `file.read.completed`
- `file.read.error`
- `file.write.completed`
- `file.write.error`

## 3. server -> browser

当前已实现：

- `snapshot`
- `agent.updated`
- `command.updated`
- `terminal.session.updated`
- `terminal.session.output`
- `terminal.session.deleted`
- `terminal.session.input.ack`

## 当前执行模型

## 1. 快速命令执行器

当前仍使用：

- `exec()`
- 单队列串行执行

这条通道没有因为新增 PTY 而被替换掉。

## 2. 会话执行器

当前已使用：

- `node-pty`

当前会话能力包括：

- PTY 创建
- stdin 写入
- 输出流回调
- resize
- idle timeout
- 退出清理

## 3. 两类任务的边界

当前实现明确区分：

- 一次性命令：走 `commandQueue`
- 交互式终端：走 `PtySessionManager`

不会把两者强行混成同一个调度器。

## 当前 profile 能力

当前 profile 由 `ToolProfileRegistry` 管理。

它现在不只合并内置 profile 和配置文件，还会按本机环境探测常见 shell / CLI，可把探测到的可执行命令自动补成 `discovered_*` profile。

当前仓库已内置或配置的常见 profile：

- `default_shell_session`
- `claude_code_session`
- `codex_code_session`

另外，若目标机上存在额外可执行命令，`localapp` 还会探测并补充诸如：

- `discovered_cmd`
- `discovered_pwsh`
- `discovered_git`
- `discovered_node`
- `discovered_python`

当前 profile 可控制：

- `runner`
- `command`
- `argsTemplate`
- `cwdPolicy`
- `outputMode`
- `finalOutputMarkers`
- `envAllowlist`
- `idleTimeoutMs`

浏览器创建会话时，会把这些 profile 按“推荐 Profile / 环境 Shell / 环境 CLI”分组展示，并支持搜索。

## Claude Code / Codex 当前状态

### Claude Code

当前仓库已把 `claude_code_session` 作为正式 profile 处理，并在服务端/前端完整贯通。

### Codex

当前仓库里也已经存在：

- `localapp/config/tool-profiles.json` 中的 `codex_code_session`

因此这里不再应写成“第一版不要把 Codex 参数模板写死”，因为 profile 已经实际落地。

更准确的说法是：

- 当前仓库已支持 Codex profile
- 目标机器是否能真正启动 `codex`，仍取决于该机器是否安装对应 CLI

## 当前安全边界

两条执行通道当前都沿用同一套安全规则：

- `auth_code` 公钥加密
- `webserver` 私钥签名
- `localapp` 验签
- `expiresAt`
- `nonce`
- `agentId`

此外，终端会话还有额外的运行时限制：

- 最大会话数
- cwd allowlist
- env allowlist
- 空闲超时

本地调试端口也已有边界：

- 本机监听
- token 鉴权
- 默认关闭

## 当前持久化与同步行为

## 1. 命令

- 内存里维护活动命令状态
- MySQL 持久化摘要到 `command_runs`

## 2. 终端会话

- 内存里维护活动会话与最近输出
- MySQL 持久化摘要到 `terminal_sessions`
- 多轮输入与 `final_text` 同步到 `terminal_session_turns`

## 3. agent 重连

当前 agent 在 `agent.register` 时会上报：

- 活动终端会话
- terminal profiles
- 常用工作目录
- 预设命令

其中 terminal profiles 现在除了静态 profile，也包含环境探测得到的 `discovered_*` profile 及其显示标签、来源、类型与可用性。

服务端会据此：

- 重建活动会话视图
- 标记丢失会话
- 向浏览器重新广播

连接保活由 `localapp` 侧主动驱动：空闲超过 `HEARTBEAT_INTERVAL_MS` 会发送 `agent.ping`，服务端回复 `agent.pong`；如果 `HEARTBEAT_TIMEOUT_MS` 内未收到对应 pong，`localapp` 会终止当前 WebSocket 并按 `RECONNECT_INTERVAL_MS` 周期重连。服务端重启时会主动发送 `1012 server_restart` 关闭帧，但 agent 侧心跳超时仍作为半开连接兜底。

## 当前实现边界

虽然双通道已经落地，但仍有这些边界：

- 一次性命令仍是单队列串行，不是并发批处理模型
- 终端原始完整流仍以内存缓存和摘要持久化为主
- 目前没有更细粒度的命令白名单策略
- profile 仍以静态配置和 allowlist 为主，不是完整策略引擎

## 当前更准确的结论

如果今天再描述这个项目，不应再写成：

- “当前缺的是会话型终端能力”
- “建议新增会话接口”
- “建议新增 PTY 会话管理器”
- “建议新增本地调试服务”

因为这些能力现在都已经存在。

当前更准确的描述应是：

> 当前项目已经形成“快速命令 + 交互式 PTY 会话 + 本地调试入口 + 远程文本文件预览与保存”的完整双通道远程执行架构。一次性命令继续保留短链路和串行执行特性，交互式终端则由 `node-pty` 承载，并通过安全 envelope、profile、cwd/env 限制和终端会话摘要持久化完成闭环。

## 最终建议

后续再扩展时，建议继续遵守这几个原则：

1. 保留快速命令通道，不要被终端会话语义吞掉
2. 继续把会话型工具放在 PTY/profile 模型下
3. 继续复用现有安全链路，不要回退到明文派发
4. 本地调试入口继续只做开发调试，不要演变成生产主入口
