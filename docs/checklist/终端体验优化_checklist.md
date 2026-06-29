# 终端体验优化 Checklist

## 目标

记录桌面端 Web 控制台终端页的待优化事项，覆盖终端顶部信息布局、窗口切换后卡顿、Shell 选择可见性和多余输入按钮移除。

## 基础原则

- [ ] 优先保持现有终端页架构、状态流和 WebSocket 事件约定不变。
- [ ] 优先解决桌面端终端 tab 的可见问题，再确认移动端是否受影响。
- [ ] 涉及终端窗口容器、高度、渲染区域的修改必须单独阶段、单独验证、单独提交，方便回滚和独立开发。
- [ ] 每项改动完成后需要进行浏览器手动验收，确认交互式终端仍可正常打开、输入和输出。

## 阶段 1：终端顶部轻量 UI 调整

- 开始时间：2026-06-28 08:59:46 +08:00
- 结束时间：2026-06-28 09:12:01 +08:00
- 开发总结：完成终端页桌面顶部压缩、tab 文本居中和交互式会话摘要信息行移除；本阶段按用户要求只做静态代码判断，未做浏览器联调。
- 验证记录：2026-06-28 09:10 运行 `npm run build:client` 通过；主流程复核 `ExploreTab.vue` 和 `styles.css` diff，确认只涉及阶段 1 前端 UI 范围。

- [x] 桌面端 Web 控制台终端 tab 右侧顶部区域压缩为一行信息：只保留“终端”标题，移除“安全命令交互式会话”说明文案，将“当前设备”“在线设备”及其具体文本一行展示，并移除无意义的额外输入按钮。（验证：webserver/client/src/styles.css:4748 以终端页限定样式压缩桌面 header，webserver/client/src/styles.css:4764 隐藏说明文案，webserver/client/src/styles.css:4775 将设备 chip 改为一行展示，webserver/client/src/styles.css:4804 隐藏终端页桌面额外截图按钮；`npm run build:client` 通过）
- [x] 调整终端界面“一次性命令”和“交互式会话”tab 的文字位置，确保文字在 tab 内上下居中。（验证：webserver/client/src/styles.css:1593 将 explore mode tab 设置为 inline-flex 居中并收紧 line-height；`npm run build:client` 通过）
- [x] 移除“交互式会话”终端界面中按钮行下方展示“默认 shell”“退出码”的信息行，因为这些信息可通过上方“详情”按钮查看。（验证：webserver/client/src/components/ExploreTab.vue 已删除 explore-session-summary-strip 模板和 Document 图标引用，webserver/client/src/components/ExploreTab.vue:1071 的“会话信息”详情弹层仍展示 Profile 与退出码；`npm run build:client` 通过）

## 阶段 2：交互式会话终端窗口高度修复

- 开始时间：
- 结束时间：
- 开发总结：
- 验证记录：

- [ ] 核查“交互式会话”终端界面底部可视高度不足的问题，重点确认打开 Codex 时最底部内容显示不全的场景，并结合后续截图定位修复。
- [ ] 保持该阶段只修改终端窗口容器、高度、滚动或 xterm 尺寸计算相关内容，不混入顶部 UI、Shell 选择或切窗卡顿优化。
- [ ] 单独验证打开 Codex 时最底部内容完整可见，并确认终端输入、滚动、resize 后显示正常。

## 阶段 3：终端窗口切换后卡顿排查和优化

- 开始时间：
- 结束时间：2026-06-28 10:31:36 +08:00
- 开发总结：用户已通过浏览器设置让该界面保持 active 来规避切窗返回卡顿，当前优化收益不高，本阶段明确标记为不做。
- 验证记录：未执行代码实现和联调验证；本阶段关闭原因来自用户手动检查结论。

- [x] 复现交互式终端持续刷新时，切换到其他窗口后再返回终端窗口出现短暂卡顿的问题。（不做：用户手动检查后确认可通过浏览器设置保持界面 active 规避，当前不再投入复现）
- [x] 排查卡顿是否来自终端输出积压、DOM 渲染、xterm 刷新、WebSocket 消息处理或页面可见性恢复逻辑。（不做：阶段关闭，不再进行代码级排查）
- [x] 根据排查结果设计优化方案，避免窗口重新获得焦点时一次性处理过多输出造成阻塞。（不做：阶段关闭，不再设计实现方案）
- [x] 验证优化后持续输出、切窗返回、滚动和输入响应均保持可用。（不做：没有代码优化可验，后续如问题重新变高优先级再单独建阶段处理）

## 阶段 4：Shell 选择信息补全

- 开始时间：2026-06-28 10:00:49 +08:00
- 结束时间：2026-06-28 10:19:12 +08:00
- 开发总结：完成默认 Shell 实际命令展示、Windows PowerShell 5/7 明确入口和前端 profile 选项去重显示；实际启动程序一致性按用户要求留待后续手动联调。
- 验证记录：2026-06-28 10:08 运行 `node --check localapp/src/runtime/tool-profile-registry.js`、`node --check localapp/src/agent-client.js` 通过；2026-06-28 10:08 运行 `npm run build:client` 通过；2026-06-28 10:16 通过 registry 输出检查确认当前 Windows 环境列出 `默认 Shell / powershell.exe`、`Windows PowerShell 5 / powershell.exe`、`PowerShell 7 / pwsh.exe`。

- [x] 终端 Shell 选择不只显示“默认 shell”，需要展示默认 shell 实际对应的具体程序。（验证：localapp/src/runtime/tool-profile-registry.js:94 为默认 shell 构建带命令 label，localapp/src/runtime/tool-profile-registry.js:939 createDefaultShellLabel 避免重复拼接；registry 输出包含 `默认 Shell / powershell.exe`）
- [x] 检查 Windows 环境下 PowerShell 5 和 PowerShell 7 的检测逻辑。（验证：localapp/src/runtime/tool-profile-registry.js:821 增加 Windows well-known 路径解析，localapp/src/runtime/tool-profile-registry.js:858 检查 PowerShell 7 安装候选目录；`node --check localapp/src/runtime/tool-profile-registry.js` 通过）
- [x] 在可用时提供 PowerShell 5 和 PowerShell 7 的明确选择入口。（验证：localapp/src/runtime/tool-profile-registry.js:409 定义 `Windows PowerShell 5 / powershell.exe`，localapp/src/runtime/tool-profile-registry.js:416 定义 `PowerShell 7 / pwsh.exe`，localapp/src/runtime/tool-profile-registry.js:360 允许默认 shell 与显式 shell 入口共存；registry 输出确认两项可用）
- [ ] 验证选择不同 Shell 后交互式终端实际启动的程序与界面显示一致。（待联调：本轮按用户要求不做真实 Windows agent/浏览器联调；代码侧 webserver/client/src/components/ExploreTab.vue:464 避免选项重复显示命令，localapp/src/runtime/tool-profile-registry.js:409 和 :416 提供明确启动命令）

## 阶段 5：会话列表管理优化

- 开始时间：2026-06-28 09:13:49 +08:00
- 结束时间：2026-06-28 09:57:07 +08:00
- 开发总结：完成会话列表清空已结束会话、后端批量删除接口、按状态排序和列表高度优化；服务端删除边界限定为已关闭状态，避免删除 running、created、dispatched、terminating 等活动态会话。
- 验证记录：2026-06-28 09:54 运行 `node --check webserver/server/src/index.js`、`node --check webserver/server/src/persistence/terminal-session-history-service.js`、`node --check webserver/server/src/state/terminal-session-store.js` 通过；2026-06-28 09:54 运行 `npm run build:client` 通过；未做浏览器/agent 联调，running 会话输出输入不中断需后续手动验收。

- [x] 在“交互式会话”的会话列表区域增加一键清空按钮。（验证：webserver/client/src/components/ExploreTab.vue:876 增加会话列表工具区，webserver/client/src/components/ExploreTab.vue:892 触发 clear-terminal-sessions，webserver/client/src/pages/ExplorePage.vue:95 绑定 store.clearTerminalSessions；`npm run build:client` 通过）
- [x] 点击清空按钮后只删除所有非 running 状态的会话，running 状态会话必须保留。（验证：webserver/server/src/index.js:825 新增 `DELETE /api/terminal-sessions` 批量接口，webserver/server/src/index.js:78 定义 closed 状态集合，webserver/server/src/index.js:1499 的 deleteClosedTerminalSessions 仅处理 closed 状态；running/created/dispatched/terminating 不进入删除集合；服务端 `node --check` 通过）
- [x] 清空前必须弹出确认对话框，明确提示将删除所有非 running 会话且 running 会话会保留，用户确认后才执行删除。（验证：webserver/client/src/stores/console.js:1879 clearTerminalSessions 先调用 ElMessageBox.confirm，确认文案说明清空已结束会话且 running 会话会保留、不影响输出输入连接；`npm run build:client` 通过）
- [x] 清空完成后刷新会话列表状态，并正确处理空列表、仅 running 会话、混合状态会话和接口失败场景。（验证：webserver/client/src/stores/console.js:407 仅存在已结束会话时启用清空按钮，webserver/client/src/stores/console.js:1930 删除返回项后调用 loadTerminalSessions 刷新并捕获错误，webserver/server/src/index.js:1458 返回 skippedRunningCount；`npm run build:client` 通过）
- [ ] 验证清空操作不影响当前 running 会话的终端输出、输入和连接状态。（待联调：本轮按用户要求不做浏览器/agent 联调；代码侧 webserver/server/src/index.js:1499 仅删除 closed 状态，webserver/client/src/stores/console.js:3156 只移除服务端返回的 deletedSessionIds）
- [x] 会话列表在现有按创建时间排序之外，增加“按状态排序”能力。（验证：webserver/client/src/components/ExploreTab.vue:879 增加时间/状态切换，webserver/client/src/stores/console.js:112 保存 terminalSessionSortMode，webserver/client/src/stores/console.js:3002 提供 setTerminalSessionSortMode；`npm run build:client` 通过）
- [x] 按状态排序时只区分 running 和非 running：running 会话排在前面，其他状态混合排在后面。（验证：webserver/client/src/stores/console.js:3514 compareTerminalSessionRecords 在 status 模式下只以 isTerminalSessionRunningStatus 分组排序；`npm run build:client` 通过）
- [x] running 分组和非 running 分组内部都继续按创建时间排序，不需要进一步区分其他状态。（验证：webserver/client/src/stores/console.js:3514 running 分组比较后回落到 createdAt 倒序；`npm run build:client` 通过）
- [x] 验证排序切换后当前选中会话、列表刷新和清空非 running 操作行为一致。（验证：webserver/client/src/stores/console.js:3002 切换排序后重排现有列表，webserver/client/src/stores/console.js:461 监听可见会话并 ensureSelectedTerminalSession，webserver/client/src/stores/console.js:2884 优先保留 running 选中；`npm run build:client` 通过）
- [x] 优化会话列表显示高度，从默认只能显示约 4 个会话调整为最多显示 8 个会话，超过 8 个后再出现滚动。（验证：webserver/client/src/styles.css:1657 将 explore-session-list max-height 调整为 560px，webserver/client/src/styles.css:1665 固定单项最小高度；`npm run build:client` 通过）
- [ ] 验证 1 到 8 个会话时列表不出现不必要滚动，超过 8 个会话时滚动可用且不会挤压终端主体区域。（待联调：本轮按用户要求不做浏览器联调；代码侧 webserver/client/src/styles.css:1657 设置 560px 上限并保留 overflow-y:auto）

## 最终完成定义

- 开始时间：
- 结束时间：
- 验收总结：

- [ ] 桌面端终端 tab 顶部区域高度明显降低，核心信息一行内清晰展示。
- [ ] “一次性命令”和“交互式会话”tab 文字上下居中，视觉位置不再偏下。
- [ ] “交互式会话”按钮行下方不再重复展示默认 shell 和退出码信息，点击“详情”仍能查看对应信息。
- [ ] “交互式会话”终端界面底部空间足够，打开 Codex 时最底部内容完整可见。
- [ ] 持续输出场景下切换窗口再返回终端页不会出现明显长时间卡顿。
- [ ] Shell 下拉选择能清楚区分默认 shell、PowerShell 5 和 PowerShell 7。
- [ ] “交互式会话”会话列表支持一键清空非 running 会话，执行前必须弹窗确认，running 会话不会被删除或中断。
- [ ] “交互式会话”会话列表支持按状态排序：running 会话优先，其余状态混合后按创建时间排序。
- [ ] “交互式会话”会话列表最多显示 8 个会话，超过 8 个后才滚动。
- [ ] 终端界面不再出现无意义的额外输入按钮，主输入流程保持正常。
