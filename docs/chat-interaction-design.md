# 聊天对话式交互设计

更新时间：2026-05-06

## 目标

在现有 Web 控制台的终端能力之外，增加一个聊天对话式交互入口，让用户可以用接近对话的方式选择设备、提交命令、查看执行结果。

这个设计的第一阶段目标不是替代现有“终端”页面，而是在不改安全协议、不改 agent 执行链路的前提下，复用已经落地的安全命令和实时回传能力，提供更低门槛的操作体验。

## 当前可复用基础

当前前端已经具备以下运行时基础：

- 路由与导航：`webserver/client/src/router/index.js`、`webserver/client/src/constants/navigation.js`
- 全局状态：`webserver/client/src/stores/console.js`
- 一次性安全命令：`submitCommand()` 调用 `/api/commands`
- 命令实时状态：浏览器 WebSocket 接收 `command.updated`
- 设备选择：`selectedAgentId`、`activeAgent`
- 授权校验：`activeAuthCodeBinding`
- 任务结果：`commands`
- 交互终端会话：`terminalSessions`、`sendTerminalInput()`、`TerminalEmulator`

因此聊天交互应优先作为前端体验层叠加，不应重新实现命令派发、安全封装或 agent 执行逻辑。

## 推荐落地路径

## 1. 第一阶段：命令聊天壳

第一阶段只做“聊天式命令提交 + 结果回填”，不接入大模型。

新增页面：

- `webserver/client/src/pages/ChatPage.vue`
- `webserver/client/src/components/ChatTab.vue`

新增导航：

- `key: "chat"`
- `path: "/chat"`
- `label: "对话"`
- `description: "以聊天方式下发命令并查看结果"`

用户输入分两类处理：

### 明确命令

如果用户直接输入类似 `hostname`、`ipconfig /all`、`whoami` 这类命令，前端生成一张待确认操作卡：

- 目标设备
- 命令内容
- 执行方式：一次性安全命令
- 确认按钮
- 取消按钮

用户确认后，调用现有 `submitCommand(commandOverride)`。

### 简单自然语言

第一阶段可以只支持少量本地规则映射：

| 用户表达 | 建议命令 |
| --- | --- |
| 查看主机名 | `hostname` |
| 当前用户是谁 | `whoami` |
| 查看网络信息 | `ipconfig /all` |
| 查看当前目录 | `cd` |

映射后仍然必须展示确认卡，由用户确认后再执行。

## 2. 第二阶段：自然语言生成操作计划

第二阶段再考虑接入 LLM，把自然语言转换为结构化操作计划。

LLM 相关逻辑建议放在 `webserver/server`，不要放在前端，原因是：

- 不暴露模型 API Key
- 方便统一做鉴权、审计和限流
- 可以在服务端做危险命令拦截
- 可以复用已有用户会话和设备绑定校验

建议新增接口：

- `POST /api/chat/plans`

请求示例：

```json
{
  "agentId": "office-pc-01",
  "message": "帮我看看这台机器的磁盘空间"
}
```

响应示例：

```json
{
  "intent": "查看磁盘空间",
  "agentId": "office-pc-01",
  "actions": [
    {
      "type": "command",
      "command": "wmic logicaldisk get caption,freespace,size",
      "riskLevel": "low",
      "requiresConfirmation": true
    }
  ]
}
```

前端拿到计划后只展示，不自动执行。执行仍然走现有 `/api/commands`。

## 前端状态设计

可以在 `useConsoleStore` 中新增聊天状态，也可以先让 `ChatTab.vue` 内部维护本地状态。

建议第一阶段先使用组件本地状态，避免把实验性 UI 过早塞进全局 store。只有这些数据需要跨页面共享时，再迁入 Pinia。

消息结构建议：

```js
{
  id: "msg_xxx",
  role: "user" | "assistant" | "system" | "action" | "result",
  agentId: "office-pc-01",
  text: "",
  command: "",
  requestId: "",
  status: "draft" | "pending" | "running" | "finished" | "failed",
  createdAt: ""
}
```

执行流：

1. 用户发送消息
2. 前端追加 `role: "user"` 消息
3. 前端解析为候选命令或请求服务端生成计划
4. 前端追加 `role: "action"` 确认卡
5. 用户确认
6. 调用现有 `submitCommand(command)`
7. 从 `commands` 中找到新增的 `requestId`
8. 后续 `command.updated` 到达时，更新对应结果消息

如果 `submitCommand()` 当前不返回新建命令记录，建议小幅调整为在成功响应后返回后端 payload 或新命令对象，方便聊天消息绑定 `requestId`。

## UI 设计建议

聊天页推荐采用三段结构：

- 顶部：当前设备选择、在线状态、auth_code 状态
- 中部：消息流
- 底部：输入框、发送按钮、常用命令快捷项

消息类型：

- 用户气泡：展示用户原始输入
- 助手气泡：展示解释、提示、错误
- 操作卡：展示待执行命令和确认按钮
- 结果卡：展示状态、退出码、耗时、输出摘要
- 原始输出折叠区：展示完整 stdout/stderr

注意事项：

- 不要把聊天页做成营销式首页
- 不要隐藏目标设备，所有操作卡都必须明确展示 `agentId` 或设备标签
- 结果输出可能很长，默认摘要展示，完整内容折叠
- 失败状态要直接暴露原因，例如未绑定 `auth_code`、设备离线、命令失败、WebSocket 断开

## 安全边界

聊天交互必须遵守现有安全链路约束：

- 不恢复明文 `command.execute`
- 不绕过 `/api/commands`
- 不绕过 `shared/secure-command.mjs`
- 不在前端、日志或接口响应中暴露私钥
- 不让大模型或前端规则自动执行高风险命令
- 所有写文件、删除文件、停止服务、修改网络、修改用户、安装软件类命令都必须二次确认

建议将命令分为三个风险级别：

| 风险级别 | 示例 | 处理方式 |
| --- | --- | --- |
| low | `hostname`、`whoami` | 普通确认 |
| medium | `ipconfig /all`、读取日志 | 普通确认，提示可能包含敏感信息 |
| high | 删除文件、停服务、改配置 | 强确认，必要时拒绝自动生成 |

## 与交互式终端的关系

聊天页第一阶段只使用一次性命令。

后续可以增加“持续会话模式”，复用已有终端会话能力：

- 用户在聊天里创建一个 terminal session
- 每条用户消息通过 `sendTerminalInput()` 发到同一会话
- 结果从 `terminalSessions.outputs` 或 `finalText` 回填到聊天气泡

这个模式适合接入长期运行的 CLI 或模型代理，但复杂度明显高于一次性命令模式，建议作为后续增强。

## Codex / AI Agent 会话模式

在普通命令聊天之外，聊天页后续需要支持 Codex、Claude Code 等 AI agent 的返回方式。推荐不要新增一套独立 AI 协议，而是复用当前已经存在的终端会话能力：

- `localapp/config/tool-profiles.json` 中的 `codex_code_session`
- `/api/terminal-sessions` 创建远程 PTY 会话
- `sendTerminalInput()` 向同一终端会话持续发送输入
- `terminalSessions.finalText` 提取最终答案
- `/api/remote-files/read` 打开 AI 返回的文件路径

这样可以继续沿用现有 `auth_code`、安全封装、agent 主动外连和文件读取链路。

### 会话类型

聊天页顶部增加会话类型选择：

- `普通会话`：保持当前逻辑，用户输入生成命令确认卡，执行走 `/api/commands`。
- `Codex 会话`：用户选择工作目录后启动 `codex_code_session`，后续每轮输入发给同一个 Codex 终端会话，聊天框只展示 Codex 的最终答案。

Codex 会话模式下建议显示以下控件：

- 目标设备
- 工作目录：支持常用目录下拉和手动输入
- AI Agent：默认 `Codex CLI`，后续可扩展 `Claude Code`
- 会话状态：未启动、启动中、运行中、已结束
- 操作按钮：开始会话、结束会话

### 输出展示

Codex 会话模式下，聊天页默认不展示原始终端输出，只展示 `finalText`。原始输出可以保留为调试折叠区，默认收起。

`finalText` 的处理规则：

- 如果是普通短文本，直接作为 assistant 消息显示。
- 如果看起来是文件路径，显示文件卡片和“打开文件”按钮。
- 点击“打开文件”时调用现有 `openRemoteFile({ sessionId, filePath })`，其中 `sessionId` 必须使用当前 Codex 终端会话 ID，便于后端解析相对路径。

文件路径识别建议支持：

- Windows 绝对路径：`C:\project\xxx\result.md`
- Unix 绝对路径：`/home/user/project/result.md`
- 相对路径：`.remote-client/codex-results/result.md`
- 简单结果目录路径：`codex-results/result.md`

如果 `finalText` 不是文件路径但明显过长，例如超过 300 字，前端可以给出轻量提示：“内容偏长，建议让 Codex 写入文件”，但第一版不强行改写。

### 输入包装提示词

Codex 会话的每轮用户输入不要直接原样发送，应由前端或 store 包装成固定提示词后再写入终端会话。提示词建议如下：

```text
请直接完成用户请求，不要输出中间思考、计划、工具调用解释或执行日志。

输出规则：
1. 最终结果必须放在 <<<FINAL>>> 和 <<<END_FINAL>>> 之间。
2. 如果结果适合在聊天框直接阅读，请直接返回 100 字以内摘要。
3. 如果结果包含以下任一情况，请写入文件并只返回文件路径：
   - 超过 100 个中文字符；
   - 包含代码块、日志、表格、清单、长命令输出；
   - 需要用户后续保存、复制或反复查看；
   - 多步骤方案或详细分析。
4. 文件请写入当前工作目录下 .remote-client/codex-results/，文件名格式为 codex-YYYYMMDD-HHmmss.md。
5. 标记中不要返回额外说明。

用户请求：
<用户输入>
```

说明：

- AI agent 负责按规则判断“直接返回短文本”还是“写入文件并返回路径”。
- 系统只负责识别 `finalText` 是短文本还是文件路径。
- 第一版不做系统侧自动落盘，避免新增远程写文件协议。
- 如果测试发现 Codex 经常不遵守规则，再考虑由 agent 或 server 增加系统级结果落盘能力。

### 状态设计

建议在 `useConsoleStore` 中增加 Chat AI 会话状态：

```js
{
  chatMode: "normal" | "codex",
  chatAiProfile: "codex_code_session",
  chatAiCwd: "",
  chatAiSessionId: "",
  chatAiPendingMessageId: "",
  chatAiLastFinalText: ""
}
```

消息结构建议扩展：

```js
{
  id: "msg_xxx",
  role: "user" | "assistant" | "system" | "action" | "file",
  mode: "normal" | "codex",
  agentId: "office-pc-01",
  sessionId: "",
  text: "",
  filePath: "",
  command: "",
  requestId: "",
  status: "draft" | "pending" | "running" | "completed" | "failed",
  createdAt: ""
}
```

### 执行流

Codex 会话建议执行流：

1. 用户切换到 `Codex 会话`
2. 选择目标设备和工作目录
3. 点击“开始会话”
4. 前端调用 `/api/terminal-sessions` 创建 `codex_code_session`
5. 保存返回的 `sessionId`
6. 用户发送聊天消息
7. 前端追加用户消息
8. 前端用固定提示词包装用户输入
9. 调用 `sendTerminalInput({ sessionId, input })`
10. 服务端通过 `terminal.session.updated` 推送 `finalText`
11. 前端根据 `finalText` 更新 assistant 消息或文件卡片

### 与普通命令模式的边界

Codex 会话不生成命令确认卡，也不直接走 `/api/commands`。它本质上是一个受控的远程终端会话，所有输入都发给 Codex CLI，由 Codex 在选定工作目录中完成任务。

普通命令模式继续保留确认卡和风险级别判断。用户需要明确执行系统命令时，仍建议使用普通会话或终端页，避免把所有操作都隐式交给 AI agent。

## 数据持久化

第一阶段建议聊天记录只保存在前端内存中，页面刷新后丢失。

后续如果需要持久化，可以新增表：

- `chat_sessions`
- `chat_messages`

但要注意：

- 命令输出可能包含敏感信息
- 持久化前应明确保留周期和清理策略
- 管理员是否能查看其他用户聊天记录需要单独定义权限

## 验证建议

第一阶段完成后至少验证：

- 未登录用户不能进入聊天页
- 未选择设备时不能生成可执行操作
- 设备未绑定 `auth_code` 时不能执行
- 设备离线时展示明确错误
- `hostname` 能通过聊天页发出并回填结果
- 执行失败时能展示错误状态和 stderr
- 前端构建通过：`npm run build:client`

## 建议实施顺序

1. 增加导航与路由
2. 新增聊天页面和基础样式
3. 实现本地消息流
4. 接入 `submitCommand(commandOverride)`
5. 绑定 `requestId` 并监听 `commands` 更新
6. 增加常用自然语言到命令的本地映射
7. 再评估是否增加服务端 `/api/chat/plans`

这个顺序可以先交付可用体验，同时避免在第一版就引入模型服务、数据库和新协议复杂度。
