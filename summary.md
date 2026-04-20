# 文档与代码不一致检查总结

检查时间：2026-04-17

本次主要对比了以下内容：

- `README.md`
- `docs/architecture.md`
- `docs/deployment-and-usage.md`
- `docs/auth-code-rsa-design.md`
- `docs/localapp-electron-design.md`
- `docs/localapp-external-terminal-design.md`
- `tools/mock-client/README.md`
- 相关实现入口：`webserver/server/src/index.js`、`webserver/server/src/security/secure-command-service.js`、`localapp/src/agent-client.js`、`localapp/src/security/secure-command-service.js`、`localapp/src/local-debug-server.js`、`db/init.sql`、`package.json`、`localapp2/*`

## 结论

发现了 4 处明确的“文档状态已落后于代码实现”的问题。`README.md` 与 `docs/deployment-and-usage.md` 本次抽查没有发现明显硬性冲突，主要问题集中在架构/设计文档的状态描述没有同步更新。

## 1. `docs/architecture.md` 仍把安全命令链路写成“待开发”

### 文档内容

- `docs/architecture.md:30` 写明“加密下发、验签和解密执行链路仍处于待开发状态”
- `docs/architecture.md:105`
- `docs/architecture.md:119`

文档中仍把 server -> agent 的消息描述为 `command.execute`，浏览器实时消息也只列了 `snapshot`、`agent.updated`、`command.updated`。

### 代码现状

- `webserver/server/src/security/secure-command-service.js`
  已实现 `command.execute.secure`
- `webserver/server/src/security/secure-command-service.js`
  已实现 `terminal.session.create.secure`
- `webserver/server/src/security/secure-command-service.js`
  已实现 `terminal.session.input.secure`
- `webserver/server/src/security/secure-command-service.js`
  已实现 `terminal.session.terminate.secure`
- `localapp/src/security/secure-command-service.js`
  已实现签名校验、私钥解密、`agentId`/`expiresAt`/`nonce` 校验
- `localapp/src/agent-client.js:95`
  agent 实际只接收 `command.execute.secure`
- `localapp/src/agent-client.js:436`
  明确拒绝未加密的 `command.execute`
- `webserver/server/src/index.js:470`
- `webserver/server/src/index.js:474`
- `webserver/server/src/index.js:485`
- `webserver/server/src/index.js:489`
- `webserver/server/src/index.js:493`
  服务端已实现 `/api/terminal-sessions*`
- `webserver/server/src/index.js:1445`
  浏览器侧还存在 `terminal.session.input.ack`
- `webserver/client/src/App.vue:1217`
- `webserver/client/src/App.vue:1223`
- `webserver/client/src/App.vue:1228`
  前端已消费 `terminal.session.updated`、`terminal.session.output`、`terminal.session.input.ack`

### 影响

`docs/architecture.md` 会误导后续维护者，以为安全命令和终端会话协议还没有落地，且会错误理解当前 WebSocket 协议面。

## 2. `docs/auth-code-rsa-design.md` 的“当前尚未完成”已经过期

### 文档内容

- `docs/auth-code-rsa-design.md:393`
- `docs/auth-code-rsa-design.md:395`
- `docs/auth-code-rsa-design.md:396`
- `docs/auth-code-rsa-design.md:397`
- `docs/auth-code-rsa-design.md:398`

文档声称以下内容“当前尚未完成”：

- 数据表实际创建
- 前端 CRUD 页面
- 服务端签名和加密发送
- `localapp` 验签和解密执行

### 代码现状

- `db/init.sql:38`
- `db/init.sql:54`
- `db/init.sql:84`
- `db/init.sql:117`
  初始化脚本已创建 `user_auth_codes`、`command_runs`、`terminal_sessions`、`terminal_session_turns`
- `webserver/server/src/index.js:338`
- `webserver/server/src/index.js:351`
- `webserver/server/src/index.js:385`
- `webserver/server/src/index.js:427`
  服务端已提供 `/api/auth-codes` 的查增改删
- `webserver/client/src/App.vue`
  前端已实现 `auth_code` 的加载、创建、编辑、删除
- `webserver/server/src/security/secure-command-service.js`
  服务端已实现加密和签名封装
- `localapp/src/security/secure-command-service.js`
  agent 已实现验签和解密
- `webserver/server/src/index.js:882`
- `webserver/server/src/index.js:883`
- `webserver/server/src/index.js:884`
  服务启动时还会自动确保相关表存在

### 影响

这份文档的状态章节会让人误判实现进度，尤其会影响新成员判断哪些能力仍需开发。

## 3. `docs/localapp-electron-design.md` 对 `localapp2` 根脚本的状态描述不再准确

### 文档内容

- `docs/localapp-electron-design.md:430`
- `docs/localapp-electron-design.md:431`
- `docs/localapp-electron-design.md:432`
- `docs/localapp-electron-design.md:437`

文档列出了：

- `dev:agent2`
- `build:agent2`
- `dist:agent2`

随后又说明这些“是未来新增项，不是当前仓库已存在脚本”。

### 代码现状

- `package.json:12`
  根脚本已经存在 `dev:agent2`
- `package.json:22`
  根脚本已经存在 `build:agent2`
- `localapp2/package.json`
  `localapp2` 内部已经存在 `dist:win`

当前真正缺的只有根级 `dist:agent2` 别名脚本，文档把三者都归类为“未来新增项”已经不准确。

### 影响

会让读者低估 `localapp2` 当前可运行程度，也会在查找实际命令入口时造成混淆。

## 4. `docs/localapp-external-terminal-design.md` 对 Codex profile 的描述已过时

### 文档内容

- `docs/localapp-external-terminal-design.md:559`

文档写的是：

“当前机器上没有找到 `codex` 可执行文件，所以第一版不要把 Codex 参数模板写死。”

### 代码现状

- `localapp/config/tool-profiles.json:21`
  已存在 `codex_code_session` profile

也就是说，代码层面已经把 Codex 终端会话 profile 放进了可配置列表，文档中的该段现状描述已经落后。

### 影响

会让读者误以为仓库还没有 Codex 会话入口，实际 profile 已经存在，只是运行时是否安装 `codex` 仍取决于目标机器环境。

## 备注

- `docs/localapp-electron-design.md` 和 `docs/localapp-external-terminal-design.md` 中有大量“建议”“推荐”“未来阶段”内容，这些属于设计提案，不应直接按“与代码不一致”处理。本 summary 只记录其中带有明确当前状态判断、且已被代码推翻的部分。
- `README.md`、`docs/deployment-and-usage.md`、`tools/mock-client/README.md` 本次抽查未发现明显的硬性冲突；它们更多是范围收敛或示例不全，而不是直接错误。
