# Mock Client

这是一个最小 Node.js CLI，用于测试两条链路：

- `localapp` 本地 debug 端口
- `webserver -> localapp` 远程链路

## 1. 本地 debug 链路

先确保 `localapp` 已开启本地调试端口，例如：

```powershell
$env:LOCAL_DEBUG_SERVER_ENABLED="true"
$env:LOCAL_DEBUG_TOKEN="debug-token"
npm run dev:agent
```

### 健康检查

```powershell
node tools/mock-client/src/index.js local-health --token debug-token
```

### 快命令测试

```powershell
node tools/mock-client/src/index.js local-command --token debug-token --command "echo hello"
```

### PTY 会话测试

```powershell
node tools/mock-client/src/index.js local-session --token debug-token --profile default_shell_session --input "echo hello from session`r"
```

### 一键冒烟

```powershell
node tools/mock-client/src/index.js local-smoke --token debug-token
```

## 2. 远程 webserver 链路

先确保：

- `webserver/server` 已启动
- `localapp` 已连上 server
- 当前用户已经为该 `agentId` 配置了 `auth_code`

### 快命令测试

```powershell
node tools/mock-client/src/index.js web-command --username admin --password ChangeMe123! --agent-id office-pc-01 --command "echo hello"
```

### 终端会话测试

```powershell
node tools/mock-client/src/index.js web-session --username admin --password ChangeMe123! --agent-id office-pc-01 --profile default_shell_session --input "echo hello from remote`r"
```

### 一键冒烟

```powershell
node tools/mock-client/src/index.js web-smoke --username admin --password ChangeMe123! --agent-id office-pc-01
```

## 3. 常用参数

- `--base-url`
- `--timeout-ms`
- `--poll-interval-ms`
- `--command`
- `--profile`
- `--cwd`
- `--input`

## 4. 环境变量

本地链路可用：

- `LOCAL_DEBUG_BASE_URL`
- `LOCAL_DEBUG_TOKEN`
- `MOCK_COMMAND`
- `MOCK_PROFILE`
- `MOCK_CWD`
- `MOCK_INPUT`

远程链路可用：

- `SERVER_BASE_URL`
- `MOCK_USERNAME`
- `MOCK_PASSWORD`
- `MOCK_AGENT_ID`
