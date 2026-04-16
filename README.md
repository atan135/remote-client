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

默认访问地址：

```text
http://localhost:5173
```

4. 启动内网 agent：

```bash
npm run dev:agent
```

## 环境变量

- 服务端参考 [webserver/server/.env.example](/c:/project/remote-client/webserver/server/.env.example)
- 内网 agent 参考 [localapp/.env.example](/c:/project/remote-client/localapp/.env.example)

## 数据库初始化

执行初始化脚本：

```bash
mysql -uroot -p -h 127.0.0.1 < db/init.sql
```

默认数据库：

- `remote_client`
- 字符集：`utf8mb4`

默认登录账号：

- 用户名：`admin`
- 密码：`ChangeMe123!`
- 公开注册默认角色：`operator`

默认端口约定：

- `webserver/server` 默认监听 `3100`
- `localapp` 默认连接 `ws://localhost:3100/ws/agent`
- `webserver/client` 开发代理默认转发到 `http://localhost:3100`

认证与用户：

- 支持登录、公开注册、退出登录
- 支持用户自助修改密码
- 管理员支持用户列表、创建用户、修改角色/启停、重置密码
