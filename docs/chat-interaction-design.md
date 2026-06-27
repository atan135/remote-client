# 聊天对话式交互说明

更新时间：2026-05-20

## 文档定位

本文按当前代码描述 Web 控制台“对话”页的实际实现。它已经不只是第一阶段设计稿：普通命令聊天壳和 Codex / AI Agent 会话模式都已落地。

主要实现入口：

- `webserver/client/src/pages/ChatPage.vue`
- `webserver/client/src/components/ChatTab.vue`
- `webserver/client/src/stores/console.js`
- `webserver/client/src/router/index.js`
- `webserver/client/src/constants/navigation.js`
- `localapp/config/tool-profiles.json`

## 当前已落地能力

### 1. 导航与页面

当前已存在：

- 路由：`/chat`
- 导航项：`key: "chat"`、`label: "对话"`
- 页面组件：`ChatPage.vue`
- 主要交互组件：`ChatTab.vue`

`ChatPage.vue` 复用 `useConsoleStore()`，把设备、命令、终端会话、远程文件读取等已有能力传给 `ChatTab.vue`。

### 2. 普通会话

普通会话用于聊天式提交一次性安全命令。

当前流程：

1. 用户输入明确命令，或输入少量支持的自然语言表达。
2. 前端追加用户消息。
3. 前端生成待确认操作卡。
4. 操作卡展示目标命令、风险等级、执行按钮和取消按钮。
5. 用户确认后调用 `store.submitCommand(command, { shell })`。
6. 后端仍走 `/api/commands`。
7. 服务端仍生成 `command.execute.secure`，不绕过安全链路。
8. 浏览器收到 `command.updated` 后，聊天结果卡同步状态和输出预览。
9. 点击“查看详情”会打开统一的 `CommandDetailDialog`。

当前支持的本地自然语言映射：

| 用户表达 | 命令 |
| --- | --- |
| 主机名 / hostname / 机器名 | `hostname` |
| 当前用户 / 用户是谁 / whoami | `whoami` |
| 网络 / ipconfig / IP 地址 / 网卡 | Windows: `ipconfig /all`；非 Windows: `ifconfig || ip addr` |
| 当前目录 / 工作目录 / pwd | Windows: `cd`；非 Windows: `pwd` |

普通会话不会调用大模型，也没有 `/api/chat/plans` 服务端计划接口。

### 3. 风险确认

普通会话会在前端做轻量命令风险分类：

- `low`：低影响或只读命令。
- `medium`：输出可能包含网络、路径或文件内容等敏感信息。
- `high`：可能删除数据、修改系统、停止服务或影响用户与权限。

高风险命令会弹出二次确认。这个分类只是前端体验层提醒，不是完整命令策略引擎。

### 4. Codex / AI Agent 会话

对话页当前已支持 `Codex 会话` 模式。

实现方式不是新增独立 AI 协议，而是复用已有远程终端能力：

- 通过 `/api/terminal-sessions` 创建远程 PTY 会话。
- 默认 profile 为 `codex_code_session`。
- 用户输入通过 `sendTerminalInput()` 发送到同一个终端会话。
- `useConsoleStore` 对 `final_only` / `hybrid` profile 自动包装最终答案提示词。
- Codex profile 走持久 PowerShell 会话，并通过 `codex exec --skip-git-repo-check --color never` 执行。
- 服务端和前端通过 `terminal.session.updated`、`finalText` 同步最终结果。
- 如果最终结果像文件路径，聊天页展示文件卡片，并用 `/api/remote-files/read` 打开远程文本文件。

相关 profile 当前在：

- `localapp/config/tool-profiles.json`

其中 `codex_code_session` 当前配置为：

- `runner: "pty"`
- `command: "pwsh"`
- `outputMode: "final_only"`
- `finalOutputMarkers.start: "<<<FINAL>>>"`
- `finalOutputMarkers.end: "<<<END_FINAL>>>"`
- 环境变量 allowlist 包含 OpenAI 相关变量和代理变量。

`claude_code_session` 也存在于 profile 配置和 profile 探测体系中；聊天页会把 `outputMode` 为 `final_only` / `hybrid` 或名称、命令包含 `codex` / `claude` 的 profile 作为 AI profile 候选。

### 5. 文件结果打开

Codex 会话最终结果如果看起来是文件路径，会显示文件卡片。

当前可识别：

- Windows 绝对路径：`C:\project\xxx\result.md`
- Unix 绝对路径：`/home/user/project/result.md`
- 相对路径：`.remote-client/codex-results/result.md`
- 简单结果目录路径：`codex-results/result.md`

点击“打开文件”后，前端调用现有 `openRemoteFile()`。绝对路径可直接打开；相对路径会携带当前 Codex 终端会话的 `sessionId`，agent 优先探测该 PTY 的实时当前目录作为基准目录。若文件名未精确命中，agent 会做受限模糊搜索，只有唯一匹配时才打开。

文件内容读取仍走 `/api/remote-files/read` 与 `file.read.secure`，由 `localapp` 使用 `fs/stat/read` 完成，不通过终端命令读取文件。Windows 目标机上的 `localapp` 不会自动转换 `/c/...` 这类 Git Bash / POSIX 风格路径。

## 当前依赖的既有能力

聊天页没有重新实现远控协议，而是复用：

- 设备状态：`agents`、`selectedAgentId`、`activeAgent`
- 授权状态：`activeAuthCodeBinding`
- 一次性命令：`submitCommand()`
- 命令实时状态：`commands` 与 `command.updated`
- 终端会话：`createTerminalSession()`、`sendTerminalInput()`、`terminateTerminalSession()`
- 远程文件读取：`openRemoteFile()`
- 统一命令详情弹窗：`CommandDetailDialog`
- 远程文件预览弹窗：`RemoteFilePreviewDialog`

这些能力都在 `webserver/client/src/stores/console.js` 中集中编排。

## 安全边界

聊天页必须继续遵守已有安全链路：

- 不恢复明文 `command.execute`。
- 普通会话执行命令必须走 `/api/commands`。
- Codex 会话必须走 `/api/terminal-sessions` 和安全终端消息。
- 文件读取必须走 `/api/remote-files/read` 和 `file.read.secure`。
- 不在前端、日志或接口响应中暴露私钥。
- 前端风险分类不等于后端安全策略，不能替代服务端权限控制。

## 数据持久化

当前聊天消息本身保存在 `ChatTab.vue` 组件内存中，页面刷新后会丢失。

但聊天页复用的底层数据仍会按已有规则处理：

- 一次性命令摘要持久化到 `command_runs`。
- 终端会话摘要持久化到 `terminal_sessions`。
- AI 会话输入和提取结果持久化到 `terminal_session_turns`。
- 远程文件读取结果不作为聊天消息单独落库。

当前没有独立的 `chat_sessions` / `chat_messages` 表。

## 当前边界

- 没有服务端 LLM 计划生成接口，也没有 `/api/chat/plans`。
- 普通会话只支持明确命令和少量本地规则映射。
- Codex 会话依赖目标机器已安装并能运行 `codex` CLI。
- 当前聊天消息不跨页面、跨浏览器或刷新持久化。
- 风险判断主要是前端正则提示，不是命令白名单或审批流。
- `Claude Code` profile 已存在，但聊天页默认文案和主要路径仍围绕 Codex 会话。

## 验证建议

对话页改动后建议至少验证：

1. 未登录用户不能进入控制台。
2. 未选择设备时不能生成可执行操作。
3. 设备未绑定 `auth_code` 时不能执行命令或启动 Codex 会话。
4. 设备离线时展示明确错误。
5. 普通会话能通过 `hostname` 提交命令并回填结果。
6. 高风险命令会触发二次确认。
7. Codex 会话能创建、发送输入、展示 `finalText`。
8. Codex 返回绝对路径时能直接打开远程文件预览；返回相对路径或唯一模糊文件名时，能按当前 Codex 终端目录解析打开。
9. 前端构建通过：`npm run build:client`。
