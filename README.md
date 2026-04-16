# Remote Control Workspace

一个最小可运行的“内网 agent + 外网控制台”架构：

- `localapp`：部署在内网机器上的 Node.js agent，主动连外网、断线重连、执行命令。
- `webserver/server`：外网 Node.js + Express 服务，负责 API、WebSocket、命令状态管理。
- `webserver/client`：Vue 3 控制台，负责设备选择、命令下发、结果展示。

## 快速启动

1. 安装依赖：

```bash
npm install
```

2. 启动服务端：

```bash
npm run dev:server
```

3. 启动前端控制台：

```bash
npm run dev:client
```

4. 启动内网 agent：

```bash
npm run dev:agent
```

## 环境变量

- 服务端参考 [webserver/server/.env.example](/c:/project/remote-client/webserver/server/.env.example)
- 内网 agent 参考 [localapp/.env.example](/c:/project/remote-client/localapp/.env.example)

