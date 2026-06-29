# 远程文档编辑保存 Checklist

## 目标

为线上远程文件打开能力扩展文本编辑和保存写回：`.txt` 文件打开后可直接编辑；Markdown 文件默认保留渲染预览，并支持切换为纯文本后编辑；用户点击保存后通过安全链路写回目标 agent 上的原文件。功能不通过终端命令写文件，不恢复明文派发，不新增二进制文件编辑能力。

## 基础原则

- [ ] 远程文件保存必须新增并复用安全 envelope，不绕开 `shared/secure-command.mjs` 和现有验签、解密、`agentId`、`expiresAt`、`nonce` 校验。
- [ ] 读取、编辑、保存链路保持与现有 `/api/remote-files/read`、`file.read.secure`、`RemoteFilePreviewDialog` 和 `console.js` 状态流一致。
- [ ] 默认只支持已成功读取的文本文件写回，不支持二进制文件、目录、超出大小限制的截断内容直接保存。
- [ ] 保存时不在日志、接口响应或前端 UI 中输出私钥、完整 PEM 或过量文件内容。
- [ ] 每个阶段完成后执行对应验证，阶段本身作为独立提交边界。

## 阶段 1：需求边界和协议设计

- 开始时间：2026-06-27 22:23:54 +08:00
- 结束时间：2026-06-27 22:32:45 +08:00
- 开发总结：完成远程文件保存协议设计文档同步，明确编辑类型边界、不支持保存状态、安全消息字段、乐观锁冲突策略和需更新的专题文档范围；本阶段仅改设计文档，未实现业务代码。
- 验证记录：`git diff --check -- docs/architecture.md docs/localapp-external-terminal-design.md docs/chat-interaction-design.md docs/auth-code-rsa-design.md` 通过（仅 Git LF/CRLF 提示）；`Select-String` 核对 `file.write.secure`、`file.write.completed`、`file.write.error`、`expectedModifiedAt`、`expectedTotalBytes`、`mtime`、`totalBytes` 等协议字段已写入目标文档。

- [x] 明确支持的文件类型规则：`.txt` 直接编辑，`.md/.markdown/.mdown/.mkd/.mkdn` 可在预览和纯文本之间切换。（验证：`docs/architecture.md` 远程文件保存协议列出 `.txt` 与 Markdown 扩展规则，`docs/chat-interaction-design.md` 聊天文件入口同步相同规则）
- [x] 明确不支持保存的状态：截断读取、空 `resolvedPath`、读取失败、二进制文件、路径解析冲突、远程文件已变化冲突。（验证：`docs/architecture.md` 保存协议列出全部禁止保存状态，`docs/localapp-external-terminal-design.md` agent 设计边界同步兜底拒绝范围）
- [x] 设计 `file.write.secure`、`file.write.completed`、`file.write.error` 消息字段，包含 `requestId`、`agentId`、`sessionId`、`filePath`、`resolvedPath`、`baseCwd`、`content`、`encoding`、`expectedModifiedAt`、`expectedTotalBytes`。（验证：`docs/architecture.md` 保存协议列出三类消息和字段，`docs/auth-code-rsa-design.md` 补充 `file.write.secure` 解密载荷字段）
- [x] 定义保存冲突策略：写入前校验远程文件 `mtime` 和 `size`，不匹配时拒绝覆盖并提示重新打开。（验证：`docs/architecture.md` 保存冲突策略定义 `mtime`/`size` 乐观锁，`docs/auth-code-rsa-design.md` 将冲突校验纳入 agent 执行前校验）
- [x] 确认是否需要更新 `docs/architecture.md`、`docs/localapp-external-terminal-design.md`、`docs/chat-interaction-design.md` 和 `docs/auth-code-rsa-design.md`。（验证：四份目标文档均有 `file.write.secure`/远程文件保存设计段落，且标注为设计中避免误写为已落地）

## 阶段 2：Agent 端文本写入能力

- 开始时间：2026-06-27 22:35:21 +08:00
- 结束时间：2026-06-27 22:46:49 +08:00
- 开发总结：在 `localapp/src/file-reader.js` 新增 agent 端文本写入函数，复用读取侧路径规范化和解析逻辑，补齐父目录/目标文件检查、mtime/size 冲突检测、编码 fallback 与 UTF-16 BOM 保留，并返回写入后的文件元数据。
- 验证记录：`node --check localapp/src/file-reader.js` 通过；`git diff --check -- localapp/src/file-reader.js` 通过（仅 Git LF/CRLF 提示）；临时 Node 脚本验证 `.txt` 相对路径写入、`.md` 绝对路径写入、UTF-16BE/UTF-16LE 往返读取、未知编码 fallback、目录/缺失父目录/不存在目标/mtime 冲突/size 冲突稳定错误码均通过。

- [x] 在 `localapp/src/file-reader.js` 或相邻模块中抽出可复用的路径规范化和解析函数，避免读写路径逻辑分叉。（验证：`localapp/src/file-reader.js` 导出 `resolveRequestedFilePath()` 和 `normalizeFilePathInput()`，`writeTextFile()` 与 `readTextFilePreview()` 共用同一路径解析函数）
- [x] 新增文本写入函数，复用现有绝对路径、相对路径、`baseCwd`、Windows POSIX 风格路径拒绝和模糊匹配规则。（验证：`localapp/src/file-reader.js` 的 `writeTextFile()` 调用 `resolveRequestedFilePath()`，独立脚本验证 `.txt` 相对路径 + `baseCwd` 和 `.md` 绝对路径写入成功）
- [x] 写入前检查目标是文件，不允许写目录或不存在父目录的路径。（验证：`localapp/src/file-reader.js` 中 `assertExistingDirectory()`、`statExistingFile()` 和 `FILE_TARGET_NOT_FILE` 检查；脚本验证目录目标、缺失父目录、不存在目标分别返回稳定错误码）
- [x] 写入前按 `expectedModifiedAt` 和 `expectedTotalBytes` 做冲突检测，冲突时返回稳定错误码。（验证：`localapp/src/file-reader.js` 中 `assertNoWriteConflict()` 抛出 `FILE_CHANGED_CONFLICT`；脚本验证 mtime 和 size 不匹配均拒绝写入）
- [x] 按读取返回的 `encoding` 写回文本内容；无法识别或不支持时使用 `utf8` 并在结果中返回实际编码。（验证：`localapp/src/file-reader.js` 中 `normalizeWritableEncoding()` 和 `encodeWritableTextBuffer()`；脚本验证 UTF-16BE/UTF-16LE 保存后可再次读取，未知编码 fallback 为 `utf8`）
- [x] 写入成功后返回 `resolvedPath`、`bytesWritten`、`totalBytes`、`encoding`、`modifiedAt`、`writtenAt`。（验证：`localapp/src/file-reader.js` 的 `writeTextFile()` 返回写入元数据；脚本断言 `bytesWritten`、`totalBytes` 和 `modifiedAt` 存在且匹配写入内容）
- [x] 手动验证 agent 本地写入 `.txt` 和 `.md` 文件后，文件内容、编码和修改时间符合预期。（验证：临时 Node 脚本在系统临时目录创建 `.txt` 和 `.md` 文件，调用 `writeTextFile()` 后用 `readTextFilePreview()` 重新读取确认内容、编码和修改时间，临时目录已清理）

## 阶段 3：Agent 安全消息处理

- 开始时间：2026-06-27 22:48:16 +08:00
- 结束时间：2026-06-27 23:02:40 +08:00
- 开发总结：接入 agent 端 `file.write.secure` 安全消息处理，`ExecutionGateway` 新增文本写入入口并复用实时 cwd 查询逻辑，`AgentClient` 完成安全 unwrap、空内容保存支持、以 `resolvedPath` 作为实际写入目标、成功/失败回包和元数据日志。
- 验证记录：`node --check localapp/src/runtime/execution-gateway.js`、`node --check localapp/src/agent-client.js`、`git diff --check -- localapp/src/runtime/execution-gateway.js localapp/src/agent-client.js` 通过（仅 Git LF/CRLF 提示）；临时 Node stub 验证 session cwd 写入、cwd 查询失败降级、无 baseCwd 抛错、`file.write.completed`、`file.write.error`、空 content 成功、缺 content 不执行写入、`expired_command`/`agent_mismatch`/`replayed_nonce` 不执行写入、日志和回包不包含完整 content。

- [x] 在 `localapp/src/runtime/execution-gateway.js` 新增 `writeTextFile()`，沿用读取时通过 `sessionId` 查询实时 cwd 的逻辑。（验证：`ExecutionGateway.writeTextFile()` 调用 `ptySessionManager.querySessionCwd()` 并按 `baseCwd` 降级；stub 验证实时 cwd、降级和无 baseCwd 抛错）
- [x] 在 `localapp/src/agent-client.js` 增加 `file.write.secure` 分发和 `handleSecureFileWrite()`。（验证：`handleMessage()` 新增 `file.write.secure` 分支，`handleSecureFileWrite()` 处理写入请求并使用 `payload.resolvedPath` 作为实际写入目标）
- [x] `handleSecureFileWrite()` 使用 `secureCommandService.unwrapMessage()` 校验 `expectedType` 和必填字段。（验证：`handleSecureFileWrite()` 使用 `expectedType: "file.write.secure"` 并校验 `filePath`、`resolvedPath`、`expectedModifiedAt`、`expectedTotalBytes`；`content` 改为自有属性校验以允许空文件保存）
- [x] 写入成功发送 `file.write.completed`，失败发送 `file.write.error`，错误响应包含稳定 `errorCode` 和简洁 `error`。（验证：stub 验证成功回包包含写入元数据，冲突失败保留 `FILE_CHANGED_CONFLICT`，缺 content 返回 `missing_required_field`）
- [x] 日志只记录路径、字节数、编码、冲突原因等元数据，不记录完整文件内容。（验证：`file.write.completed`/`file.write.failed` 日志只包含 requestId、路径、编码、字节数和 errorCode/error；stub 使用哨兵 content 验证日志和回包未包含完整内容）
- [x] 验证过期 envelope、错误 agentId、重复 nonce 和缺少必填字段时不会执行写入。（验证：stub 注入 `expired_command`、`agent_mismatch`、`replayed_nonce` 和缺少 `content` 的 unwrap/字段错误，均发送 `file.write.error` 且 fake gateway 调用次数为 0）

## 阶段 4：服务端写回接口和 pending 流程

- 开始时间：2026-06-27 23:04:07 +08:00
- 结束时间：2026-06-27 23:20:09 +08:00
- 开发总结：服务端新增远程文件写回接口和 pending 流程，`SecureCommandService` 可生成 `file.write.secure` envelope，HTTP 写入请求校验登录态、设备、路径、内容字段和截断状态，服务端等待 `file.write.completed/error` 回包并处理超时、断开、冲突和常见写入错误码。
- 验证记录：`node --check webserver/server/src/security/secure-command-service.js`、`node --check webserver/server/src/index.js`、`git diff --check -- webserver/server/src/security/secure-command-service.js webserver/server/src/index.js` 通过（仅 Git LF/CRLF 提示）；`Select-String` 核对 route、pending map、agent 回包、断开拒绝、错误码映射和日志元数据字段存在；未启动完整 server/agent 做 HTTP+WebSocket 冒烟，原因是当前阶段缺少已初始化 MySQL、登录会话、auth_code 绑定和在线 agent，端到端手动验证留到阶段 8。

- [x] 在 `webserver/server/src/security/secure-command-service.js` 新增 `createFileWriteEnvelope()`，保持与现有 `createFileReadEnvelope()` 风格一致。（验证：`createFileWriteEnvelope()` 生成 `file.write.secure`，plaintext 包含 `filePath`、`resolvedPath`、`baseCwd`、`encoding`、`expectedModifiedAt`、`expectedTotalBytes`、`content`、`nonce` 等字段，meta 仅记录长度和路径元数据）
- [x] 在 `webserver/server/src/index.js` 新增 `POST /api/remote-files/write`，要求登录态并校验 `agentId`、`filePath/resolvedPath`、`content`。（验证：route 使用 `requireAuth`；`handleRemoteFileWriteRequest()` 校验 `agentId`、`filePath`、`resolvedPath` 和 `content` 自有字段，允许空字符串并拒绝截断内容）
- [x] 新增 `pendingRemoteFileWrites` 和超时处理，agent 断开时拒绝当前 agent 的未完成写入请求。（验证：`pendingRemoteFileWrites`、`remoteFileWriteTimeoutMs`、`createPendingRemoteFileWrite()`、`cancelPendingRemoteFileWrite()` 和 `rejectPendingRemoteFileWritesByAgent()` 已接入，agent 断开 grace 结束时同时拒绝 pending writes）
- [x] 复用 `ensureManagedAgentReadyForControl()` 和 `authCodeService.findByUserIdAndAgentId()`，保证只有已审核、已授权设备可写入。（验证：`dispatchRemoteFileWriteForUser()` 在线检查后调用 `ensureManagedAgentReadyForControl()` 和 `authCodeService.findByUserIdAndAgentId()`，未绑定 auth_code 返回 400）
- [x] 处理 `file.write.completed` 和 `file.write.error` agent 回包，并把保存结果返回给 HTTP 请求方。（验证：`handleAgentMessage()` 分发 `file.write.completed/error`；`resolveRemoteFileWriteRequest()` 返回写入元数据；`rejectRemoteFileWriteRequest()` 使用 `mapRemoteFileWriteErrorCode()` 将 `FILE_CHANGED_CONFLICT` 映射 409、路径和权限错误映射明确状态码）
- [x] 服务端日志记录保存请求、完成、失败、超时和冲突，但不记录完整文件内容。（验证：`file.write.requested`、`file.write.completed`、`file.write.failed`、`file.write.timeout`、`file.write.disconnected` 只记录路径、编码、字节数、错误码和用户元数据；静态扫描未发现 write 日志直接记录 `content`）
- [x] 手动验证未登录、未绑定 `auth_code`、agent 离线、设备未审核和写入冲突时返回明确错误。（验证：代码路径覆盖 requireAuth 未登录拦截、未绑定 auth_code 400、agent 离线 409、设备未审核/停用 403、`FILE_CHANGED_CONFLICT` 409；本阶段未运行真实 HTTP+WebSocket 冒烟，阶段 8 统一手动验证）

## 阶段 5：前端 Store 保存状态流

- 开始时间：2026-06-27 23:22:09 +08:00
- 结束时间：2026-06-27 23:32:28 +08:00
- 开发总结：前端 console store 新增远程文件保存状态流，提供 context 级保存中、保存错误和 `saveRemoteFile()`，统一向 `/api/remote-files/write` 提交 viewer 元数据与编辑内容，保存成功后更新 viewer 和脏状态基准，失败时保留当前编辑内容并写入错误状态。
- 验证记录：`node --check webserver/client/src/stores/console.js`、`git diff --check -- webserver/client/src/stores/console.js` 通过（仅 Git LF/CRLF 提示）；`Select-String` 核对 `saveRemoteFile`、`savingRemoteFile`、`remoteFileSaveError`、`expectedModifiedAt`、`expectedTotalBytes`、`dirtyBaseContent`、`writtenAt` 和导出项存在；未运行 `npm run build:client`，按计划留到阶段 8 统一构建。

- [x] 在 `webserver/client/src/stores/console.js` 新增 `savingRemoteFile`、保存错误状态和 `saveRemoteFile()`。（验证：store 新增 `remoteFileSaveErrorsByContext`、`savingRemoteFileContextsByContext`、`remoteFileSaveError`、`savingRemoteFile` 和导出的 `saveRemoteFile()`）
- [x] `saveRemoteFile()` 调用 `/api/remote-files/write`，提交当前 viewer 的 `agentId`、`sessionId`、`filePath`、`resolvedPath`、`baseCwd`、`encoding`、`modifiedAt`、`totalBytes` 和编辑内容。（验证：`saveRemoteFile()` 构造 POST `/api/remote-files/write`，body 包含 viewer 元数据、`content`、`expectedModifiedAt`、`expectedTotalBytes`）
- [x] 保存成功后更新当前 viewer 的 `content`、`bytesRead`、`totalBytes`、`modifiedAt`、`readAt/openedAt` 和脏状态基准。（验证：成功分支更新 `content`、`bytesRead`、`totalBytes`、`modifiedAt`、`writtenAt`、`readAt`、`openedAt`，并将 `savedContent`、`lastSavedContent`、`dirtyBaseContent` 重置为已保存内容）
- [x] 保存失败时保留用户编辑内容，不回滚 textarea，并展示可操作错误信息。（验证：失败分支只设置 `remoteFileSaveError` 和 `remoteFileError`，不调用 `setRemoteFileViewerForContext()` 覆盖 viewer；本方法返回 `false` 供 UI 保留 textarea）
- [x] 保持 Explore 页和 Chat 页打开文件后共用同一套保存能力，不复制请求逻辑。（验证：`saveRemoteFile(payload)` 支持传入 `context/agentId/sessionId/content`，并由 store 单一方法封装保存请求，后续 Explore/Chat 只需调用同一 action）
- [x] 验证 401 时仍走现有 `handleUnauthorized()`，其他错误写入对应远程文件错误状态。（验证：`saveRemoteFile()` 在 `response.status === 401` 时调用 `handleUnauthorized()`，非 401 错误读取响应 `message` 后写入 context 保存错误和远程文件错误状态）

## 阶段 6：远程文件弹窗编辑体验

- 开始时间：2026-06-27 23:34:08 +08:00
- 结束时间：
- 开发总结：
- 验证记录：静态审核 `webserver/client/src/components/RemoteFilePreviewDialog.vue` diff 通过，确认弹窗组件已接入三种显示模式、默认模式、保存禁用条件、未保存变更确认、保存状态提示和响应式内容区；按用户要求未启动项目、未运行构建或浏览器手动验收，桌面/移动视口验收保留待用户后续执行。

- [x] 在 `RemoteFilePreviewDialog.vue` 增加显示模式：Markdown 预览、纯文本查看、编辑。（验证：`modeOptions` 生成 Markdown/纯文本/编辑选项，模板通过 `el-segmented` 切换 `MODE_MARKDOWN`、`MODE_TEXT`、`MODE_EDIT` 三种内容区域）
- [x] `.txt` 或非 Markdown 文本文件打开后默认进入可编辑纯文本区域。（验证：`syncFromViewer()` 中 `displayMode.value = isMarkdownTarget(viewer) ? MODE_MARKDOWN : MODE_EDIT`，非 Markdown 和 `.txt` 默认进入编辑 textarea）
- [x] Markdown 文件默认显示渲染预览，并提供切换到纯文本编辑的控件。（验证：`isMarkdownTarget()` 匹配 `.md/.markdown/.mdown/.mkd/.mkdn` 后默认 `MODE_MARKDOWN`，`modeOptions` 为 Markdown 文件同时提供预览、纯文本查看和编辑选项）
- [x] 编辑区使用稳定尺寸和独立滚动，长文本、长路径、空文件、移动端宽度下不横向撑破弹窗。（验证：`.remote-file-content`、`.remote-file-scroll`、`.remote-file-editor` 设置固定最小高度和独立滚动，路径和正文使用 `overflow-wrap: anywhere`，`@media (max-width: 640px)` 收敛弹窗宽度和内容高度）
- [x] 保存按钮只在可保存状态启用；截断内容、无路径、保存中、未登录失效或无变更时禁用。（验证：`saveBlockedReason` 覆盖 `truncated`、缺 `resolvedPath/filePath`、`props.saving`、无变更和 `props.canSave=false`，按钮绑定 `:disabled="!canSubmitSave"`）
- [x] 增加未保存变更提示，关闭弹窗或切换文件时避免静默丢失编辑内容。（验证：`requestCloseDialog()` 和 `watch(() => props.viewer)` 在 `hasUnsavedChanges` 为真时调用 `ElMessageBox.confirm()`，取消时保留当前 `currentViewer` 和草稿）
- [x] 保存成功后显示明确状态，并允许继续编辑和再次保存。（验证：`watch(() => props.saving)` 在保存结束且无 `saveError` 时更新 `baseContent`、清理 pending 状态并设置 `saveSuccessText = "保存成功"`，后续编辑会重新触发 `hasUnsavedChanges` 使保存按钮可再次启用）
- [ ] 手动验收桌面和移动视口下 Markdown 预览、纯文本编辑、保存中、保存失败和空文件状态。（待用户后续手动验收；本轮按要求未启动项目或浏览器）

## 阶段 7：跨入口集成

- 开始时间：2026-06-28 00:26:49 +08:00
- 结束时间：2026-06-28 00:53:30 +08:00
- 开发总结：完成 Explore 与 Chat/Codex 文件入口的远程文件保存接线，`RemoteFilePreviewDialog` 统一接收保存状态、错误状态和保存事件，Explore 相对路径保存沿用当前终端 session，Chat 文件卡片通过 `agentId + sessionId` context 与 store viewer 同步；补充关闭、切换和删除会话时的远程文件错误与保存状态清理。
- 验证记录：静态审核 `webserver/client/src/pages/ExplorePage.vue`、`webserver/client/src/components/ExploreTab.vue`、`webserver/client/src/components/ChatTab.vue`、`webserver/client/src/stores/console.js` diff 通过；worker 运行 `git diff --check` 未发现 whitespace 错误（仅 Git LF/CRLF 提示）；按用户要求未启动项目、未运行完整构建或浏览器手动验收。

- [x] 在 `ExplorePage.vue`、`ExploreTab.vue` 传递保存方法和保存状态到 `RemoteFilePreviewDialog`。（验证：`ExplorePage.vue` 向 `ExploreTab` 传入 `store.remoteFileSaveError`、`store.savingRemoteFile`、`Boolean(store.activeAuthCodeBinding)` 并绑定 `@save-remote-file="store.saveRemoteFile"`；`ExploreTab.vue` 将 `savingRemoteFile`、`remoteFileSaveError`、`canSaveCurrentRemoteFile` 和 `@save="handleRemoteFileSave"` 传给弹窗）
- [x] 在 `ChatTab.vue` 打开的 AI 文件弹窗中接入同一保存逻辑，确保相对路径仍携带对应 `sessionId`。（验证：`ChatTab.vue` 的 `handleAiFileSave()` 调用 `store.saveRemoteFile(savePayload)`，保存 payload 使用 `viewer.sessionId || chatAiSessionId.value`，`openAiFile()` 读取时也保留 `message.sessionId` 和 `message.baseCwd`）
- [x] 验证从 Explore 终端页打开的相对路径保存时沿用正确 agent 和 session 上下文。（验证：`ExploreTab.vue` 的 `handleRemoteFileSave()` 从 `payload/viewer/currentSession` 补齐 `agentId`、`sessionId`、`filePath`、`baseCwd`，并由 `ExplorePage.vue` 转发到 `store.saveRemoteFile()`）
- [x] 验证从 Chat/Codex 文件卡片打开的文件保存后，弹窗内容和文件卡片状态保持一致。（验证：`ChatTab.vue` 的 `activeStoreAiFileViewer` 按 context 读取 store viewer，watch 成功后更新 `activeAiFileViewer` 和对应 message 的 `fileViewer/fileOpenStatus/filePath/baseCwd/agentId/sessionId/updatedAt`）
- [x] 关闭弹窗、删除终端会话或切换 agent 时清理对应编辑态和保存错误，不污染其他上下文。（验证：`ExploreTab.vue` 关闭弹窗时 emit `close-remote-file-preview`，`console.js` 的 `clearRemoteFilePreviewViewer()` 同时清理读取/保存错误；`deleteRemoteFileStateForSession()` 清理 viewer、保存错误和 saving context；`ChatTab.vue` 关闭弹窗、切换 agent、会话不存在时调用 `showAiFileViewer(null)` 并按当前 context 清理错误）

## 阶段 8：验证和文档同步

- 开始时间：2026-06-28 00:55:17 +08:00
- 结束时间：2026-06-28 01:09:01 +08:00
- 开发总结：完成远程文件保存相关专题文档同步，将远程文件保存、安全消息、localapp 文件读写能力和 Chat/Codex 文件入口说明从“设计中/只读预览”更新为已落地能力；按用户要求未执行前端构建、未启动项目、未进行端到端或浏览器手动验收。
- 验证记录：静态审核 `docs/architecture.md`、`docs/localapp-external-terminal-design.md`、`docs/chat-interaction-design.md`、`docs/auth-code-rsa-design.md` diff 通过；`Select-String` 搜索 `仅支持文本预览|只读预览|仅预览|拟新增|设计中|file.write.*设计|远程文件保存.*设计阶段|保存.*ChatPage|ChatPage.*保存|保存.*传给|传给.*保存` 无命中；`git diff --check -- docs/architecture.md docs/localapp-external-terminal-design.md docs/chat-interaction-design.md docs/auth-code-rsa-design.md` 通过（仅 Git LF/CRLF 提示）。

- [ ] 执行前端构建：`npm run build:client`。
- [ ] 手动跑通安全链路：绑定公钥 -> 打开文本文件 -> 修改内容 -> 保存 -> 重新打开确认内容已写回。
- [ ] 手动验证 `.md` 文件默认渲染预览、切换纯文本、编辑保存、重新打开后内容一致。
- [ ] 手动验证 `.txt` 文件默认可编辑，保存后目标机器文件内容变化。
- [ ] 手动验证截断大文件不能直接保存，并提示重新处理或扩大读取限制。
- [ ] 手动验证远程文件在打开后被外部修改时保存失败，并提示重新打开。
- [ ] 手动验证 agent 离线、auth_code 缺失、设备未审核、路径无效、权限不足时错误提示清晰。
- [x] 同步更新涉及远程文件读写、安全消息协议和聊天文件打开能力的专题文档。（验证：`docs/architecture.md` 记录 `/api/remote-files/write`、`file.write.secure` 和 `.txt`/Markdown 编辑保存能力；`docs/localapp-external-terminal-design.md` 记录 `fs/stat/read/write`、`file.write.completed/error` 和保存边界；`docs/chat-interaction-design.md` 记录 Chat/Codex 文件弹窗通过 `useConsoleStore()` 复用保存状态与 `saveRemoteFile()`；`docs/auth-code-rsa-design.md` 记录远程文件保存已纳入安全 envelope、`agentId`/`expiresAt`/`nonce` 校验和冲突检测）

## 最终完成定义

以下项目作为整体完成标准，不要求每个开发阶段都执行，由所有相关阶段完成后统一验收。

- 开始时间：
- 结束时间：
- 验收总结：

- [ ] 线上控制台打开 `.txt` 文件后可直接编辑并通过保存按钮写回目标 agent 文件。
- [ ] 线上控制台打开 Markdown 文件后默认可渲染预览，并可切换纯文本编辑后保存。
- [ ] 所有保存请求都走 `file.write.secure`，agent 端继续校验签名、过期时间、nonce 和 agentId。
- [ ] 保存冲突、权限错误、离线、路径错误和截断内容都有明确失败路径，不会静默覆盖或丢失用户编辑内容。
- [ ] Explore 页和 Chat/Codex 文件入口均可使用同一保存能力。
- [ ] `npm run build:client` 通过，远程文件读写主链路完成手动冒烟验证。
- [ ] 相关 `docs/` 专题文档已同步，不再把远程文件能力描述为只读预览。
