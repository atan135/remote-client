# remote-client 与 OpenClaw 对比分析

更新时间：2026-04-21

## 1. 对比口径

本文对比的不是“两个都能跑命令，所以谁更强”这种泛化结论，而是看两者的产品定位和实际落地能力是否一致。

- `remote-client`：本仓库里的远程终端/远程命令系统，核心是“目标机 agent 主动外连 + Web 控制台下发安全命令 + 保持交互式终端会话”。
- `OpenClaw`：更偏“自托管 AI Gateway / AI agent runtime”，核心是“多渠道接入 + agent 工具调用 + memory + skills + plugins + sub-agents + ACP harness”。

所以两者不是完全同类产品：

- `remote-client` 更像“面向指定目标机的远程运维终端”。
- `OpenClaw` 更像“面向多入口、多工具、多 agent 的通用 AI 运行平台”。

## 2. 核心结论

如果目标是“稳定、安全、低延迟地远程控制一台或一组指定机器，并保持真实终端会话”，`remote-client` 更聚焦，也更直接。

如果目标是“把 AI agent 接到 Web、IM、手机、浏览器、sub-agent、browser automation、memory、plugins、Codex/Claude Code/Gemini CLI 等统一生态里”，`OpenClaw` 的能力面更大。

一句话概括：

- `remote-client` 赢在“专注远控、链路更短、终端更真、控制面更窄”。
- `OpenClaw` 赢在“AI 平台化、生态广、扩展强、入口多”。

## 3. 你已想到的三点，结论与修正

### 3.1 隐私性：`remote-client` 整体更好，但要区分控制面与模型面

这个判断总体成立，但建议写得更严谨一些。

`remote-client` 的优势在于：

- 控制入口单一，主要就是你自己的 `webserver + localapp`。
- 目标机 agent 主动外连，不需要把目标机暴露成公网入口。
- 命令链路不是明文，当前实现是“用户绑定 `auth_code` 公钥 + 服务端签名 + agent 验签/解密 + `agentId`/`expiresAt`/`nonce` 校验”。
- 没有像 OpenClaw 那样天然鼓励接 Telegram、Slack、WhatsApp、WebChat 这类外部消息面。

但也要补一句限制：

- 如果 `remote-client` 的交互式会话里实际跑的是 `claude`、`codex` 这类云端 CLI，那么“模型内容”依然会发到 Anthropic/OpenAI；更准确的说法是：`remote-client` 的**远控控制面隐私**更好，不代表**模型推理面**天然完全本地。

`OpenClaw` 方面，官方文档也明确写了：

- 会话、memory、config、workspace 默认保存在本地；
- 但发给模型提供商的数据仍会去对应 API；
- 如果接入 WhatsApp/Telegram/Slack 等渠道，消息数据也会经过这些渠道服务器。

所以隐私结论应写成：

> 在“远程控制链路”和“控制面暴露面”上，`remote-client` 明显优于 OpenClaw；在“模型推理是否出本机”上，两者都要看你实际接的模型或 CLI。

### 3.2 保持会话：`remote-client` 更强，但要说明“保持的是什么会话”

这个判断也成立，而且这是两者非常关键的差异点。

`remote-client` 当前保持的是：

- 真实 PTY/终端会话；
- 持续存在的 shell 进程状态；
- 目录、上下文、前后命令环境延续；
- 会话输出流；
- 服务端侧的会话摘要和多轮输入/`final_text` 摘要持久化。

这意味着它更接近：

- “我真的连上了目标机器的一段终端”
- 而不是“我在和一个会记上下文的 agent 聊天”

OpenClaw 也有 session continuity，但它主要保持的是：

- agent 会话；
- 聊天上下文；
- transcript；
- thread-bound ACP session；
- memory/workspace 语义上的连续性。

OpenClaw 甚至也能把 Codex/Claude Code 之类作为 ACP harness 跑起来，并把 follow-up 绑定到同一 session/thread。  
但它的“会话连续”更偏向“AI 会话/agent runtime 连续”，不等价于“一个你专门维护的远程 shell 进程”。

所以建议表述为：

> `remote-client` 在“真实远程终端持续驻留”这件事上更强；OpenClaw 在“agent/聊天/ACP 会话连续性”上也很强，但两者连续的是不同层。

### 3.3 执行速度：对“明确命令执行”场景，`remote-client` 更快

这个判断大体成立，但最好加边界条件。

`remote-client` 的典型链路是：

`Web 控制台 -> 服务端安全封装 -> agent -> 本地 exec/pty`

链路短，没有额外的：

- prompt 组装
- model 推理
- tool planning
- agent loop 串行调度

所以在下面这类场景中，它通常更快：

- 已知命令直接执行
- 一次性运维命令
- 已知 cwd 下的交互式终端输入
- 文件直接读取

OpenClaw 的强项不是“最短命令链路”，而是“让 agent 理解任务并决定要调哪些工具”。  
因此在“我已经知道要执行什么命令”时，OpenClaw 通常会更重；但在“我只说目标，让 agent 自己拆解”时，OpenClaw 可能减少人工步骤。

所以更准确的结论是：

> 对“确定性远程命令/终端操作”，`remote-client` 通常更快；对“自然语言目标分解 + agent 自主执行”，OpenClaw 的综合效率可能更高。

## 4. 其他关键比较维度

## 4.1 产品定位

### remote-client

优势：

- 定位非常清晰，就是远程命令、交互式终端、远程文件预览。
- 用户心智简单，接近传统远控/远程终端。
- 更适合研发、运维、内网机器管理。

劣势：

- 能力面更窄。
- 不以“多渠道 AI 入口”见长。
- 不是通用 agent 平台。

### OpenClaw

优势：

- 是完整 AI Gateway 平台，不只是远程命令。
- 可从 Web、手机、聊天软件等多入口接入。
- 更适合“随时随地找 AI 干活”的统一入口。

劣势：

- 对纯远控需求来说偏重。
- 用户心智比远程终端复杂。

## 4.2 安全模型

### remote-client

当前实现的安全边界比较明确：

- 用户与 `agentId` 绑定 `auth_code`
- 服务端用目标公钥加密
- 服务端私钥签名
- agent 端验签、解密
- 校验 `agentId`
- 校验 `expiresAt`
- 校验 `nonce` 防重放
- 明确拒绝不安全的明文 `command.execute`

优点：

- 这是“面向远程控制链路”的定制化安全设计，针对性很强。
- 每个用户对每个设备可以独立绑定公钥，边界清晰。

不足：

- 目前还是较粗粒度的权限模型，角色只有 `admin / operator / viewer`。
- 还没有成熟的命令白名单/细粒度策略系统。

### OpenClaw

OpenClaw 的安全更像“通用 agent runtime 安全”：

- gateway token/password
- remote/TLS/SSH/Tailscale
- sandbox
- exec approvals
- allowlist/denylist
- DM pairing
- node host approvals

优点：

- 安全能力面更广，覆盖渠道接入、sandbox、browser、node、exec approvals 等。
- 更适合复杂 agent 平台。

不足：

- 配置和理解成本更高。
- 安全面广也意味着误配置空间更大。
- 对“远控命令链路本身”的针对性，不如 `remote-client` 这种专门设计来得直接。

## 4.3 终端真实性

这是 `remote-client` 很值得强调的一点。

`remote-client` 已经落地的是：

- PTY 会话
- 持续 stdin/stdout
- resize
- terminate
- cwd 限制
- session idle timeout
- reconnect 时上报当前 active terminal sessions

因此它更像真正的“远程终端产品”。

OpenClaw 虽然也能：

- `exec`
- `pty`
- `host=node`
- ACP session
- thread-bound session

但它的主语义仍然是“agent runtime/tool runtime”，不是“给你一段专属远程 shell”。  
所以在终端体验真实性上，`remote-client` 更像 SSH / remote shell 的抽象。

## 4.4 持久化与审计

### remote-client

优势：

- 已经把 `command_runs`
- `terminal_sessions`
- `terminal_session_turns`
- 用户会话
- `auth_code`

落到 MySQL。

同时还做了：

- 命令输出摘要持久化
- 终端会话摘要持久化
- `final_text` 提取
- 会话 turn 级记录

不足：

- 在线状态仍是内存态。
- 终端原始完整流不是完整长期落库，只保留摘要和尾部片段思路。
- 更像“运维审计/回看”而不是“完整 agent 知识库”。

### OpenClaw

优势：

- session metadata 与 transcript 是体系化设计。
- memory、workspace、sessions、skills、auth profiles、credentials 各自有明确存储位置。
- 对 agent 长期上下文、compaction、memory flush 更成熟。

不足：

- 它保存的是“agent 会话与记忆体系”，并不天然等价于“某台远程机器的运维审计日志”。

## 4.5 扩展能力与生态

这是 OpenClaw 的显著优势。

### remote-client

当前更强的是：

- 专注远程命令
- 专注终端
- 专注远程文件查看
- 可直接跑 `claude`/`codex` profile

但它的扩展方式主要还是你自己继续开发。

### OpenClaw

官方体系已经覆盖：

- tools
- skills
- plugins
- browser
- web search
- memory
- multi-agent routing
- sub-agents
- ACP agents
- nodes
- macOS companion app
- 多种 chat channel

结论：

- 想做“自定义远控产品”，`remote-client` 更适合。
- 想接进一个大生态，OpenClaw 更强。

## 4.6 运维复杂度

### remote-client

优势：

- 架构更窄：`server + client + agent`
- 目标明确
- 问题排查路径短

不足：

- 你需要自己维护协议、前后端、agent、数据库、密钥体系。
- 社区和现成插件生态弱于 OpenClaw。

### OpenClaw

优势：

- 官方文档、插件、CLI、平台能力齐全。
- 很多高级能力不用自己从零做。

不足：

- 系统更重，配置项和运行面更多。
- 如果只是为了“远程终端”，会有明显的过度建设。

## 5. 双方优劣总结

## remote-client 的主要优势

- 更适合“远程终端/远程运维”这个明确场景。
- 控制链路更短，已知命令执行更快。
- 远控控制面的隐私性更好，暴露面更窄。
- 有真实 PTY，会话保持更接近真正远程 shell。
- 安全链路针对远控场景做得比较扎实。
- 用户-设备级 `auth_code` 绑定，边界清楚。
- Web 控制台就是围绕目标设备控制设计的，产品形态更直接。

## remote-client 的主要劣势

- 生态面和扩展面明显小于 OpenClaw。
- 不是完整 AI agent 平台。
- 细粒度权限、策略控制、命令白名单还不够强。
- 长期维护成本主要由你自己承担。

## OpenClaw 的主要优势

- 是成熟的通用 AI Gateway / agent runtime。
- 多渠道、多平台、多工具接入能力很强。
- memory、skills、plugins、browser、sub-agents、ACP 都很完整。
- 可以把 Codex/Claude Code/Gemini CLI 纳入统一运行框架。
- 社区和生态更强，功能演进更快。

## OpenClaw 的主要劣势

- 对“纯远程终端”需求来说过重。
- 链路更长，显式命令执行通常不如专用远控链路直接。
- 常见使用方式下数据面更大，隐私边界不如专用远控产品收敛。
- 会话连续更偏 agent/session 语义，不完全等于真实远程 shell 持续驻留。

## 6. 最适合的结论表达

如果你要把这个比较写成对外或对内的简洁结论，我建议用下面这段：

> `remote-client` 和 OpenClaw 的核心差异，不是“谁功能多一点”，而是产品方向不同。OpenClaw 是通用型 AI Gateway / agent runtime，强调多渠道接入、tool/skill/plugin 生态、memory 与多 agent 能力；`remote-client` 则更聚焦“指定目标机器的安全远程终端与远程运维”，在控制链路隐私、真实终端保持、确定性命令执行延迟和远控产品心智上更有优势。  
> 对于“我想稳定地连上一台机器并持续操作终端”的需求，`remote-client` 更合适；对于“我想让 AI 从 Web、手机、聊天软件等多个入口统一调用复杂工具生态”的需求，OpenClaw 更合适。

## 7. 本项目更适合强调的卖点

结合当前实现，你这个项目最值得强调的卖点建议是：

1. 控制面更私有、更收敛，不依赖外部 IM/多渠道入口。
2. 真实远程终端会话可持续保持，不只是聊天上下文连续。
3. 明确命令执行链路更短，已知运维动作响应更快。
4. 针对远控链路做了专门的加密、签名、验签、过期和防重放设计。
5. 产品形态更贴近“远程终端/远程运维”，而不是“通用 AI 平台”。
6. 对研发/运维团队来说心智更简单，落地更直接。

## 8. 参考依据

### remote-client 仓库内

- `CLAUDE.md`
- `docs/deployment-and-usage.md`
- `docs/architecture.md`
- `localapp/src/agent-client.js`
- `localapp/src/runtime/pty-session-manager.js`
- `localapp/src/runtime/tool-profile-registry.js`
- `webserver/server/src/index.js`
- `webserver/server/src/security/secure-command-service.js`
- `shared/secure-command.mjs`
- `db/init.sql`

### OpenClaw 官方资料

- GitHub：<https://github.com/openclaw/openclaw>
- 官方首页：<https://docs.openclaw.ai/>
- Session Management：<https://docs.openclaw.ai/concepts/session>
- Memory Overview：<https://docs.openclaw.ai/concepts/memory>
- Agent Workspace：<https://docs.openclaw.ai/concepts/agent-workspace>
- Tools and Plugins：<https://docs.openclaw.ai/tools>
- Exec Tool：<https://docs.openclaw.ai/tools/exec>
- Browser Tool：<https://docs.openclaw.ai/tools/browser>
- Sub-Agents：<https://docs.openclaw.ai/tools/subagents>
- ACP Agents：<https://docs.openclaw.ai/tools/acp-agents>
- Nodes：<https://docs.openclaw.ai/nodes>
- Remote Access：<https://docs.openclaw.ai/gateway/remote>
- FAQ：<https://docs.openclaw.ai/help/faq>

注：OpenClaw 迭代很快，以上对比以 2026-04-21 当天查阅到的官方文档与仓库公开信息为准。
