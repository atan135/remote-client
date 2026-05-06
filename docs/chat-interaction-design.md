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
