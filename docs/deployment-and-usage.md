# 部署与使用说明

本文档覆盖当前仓库中以下内容：

- 测试环境如何启动和使用
- 正式环境如何部署 `webserver`
- `localapp` 如何在 Windows 和 Linux 上部署

当前不包含 `localapp2` 的部署说明。

## 1. 适用范围与组件说明

本仓库当前包含 3 个实际运行组件：

- `webserver/server`：服务端，负责登录鉴权、会话、`auth_code` 管理、命令派发、WebSocket
- `webserver/client`：前端控制台，生产环境构建后由 `webserver/server` 静态托管
- `localapp`：部署在目标机器上的 Node.js agent，主动连接服务端并执行命令

整体链路如下：

1. 浏览器访问 `webserver`
2. 用户登录 Web 控制台
3. `localapp` 主动连接 `webserver`
4. 用户为指定 `agentId` 录入对应的 `auth_code` 公钥
5. 用户在控制台下发命令或创建终端会话
6. `webserver` 加密并签名后下发给 `localapp`
7. `localapp` 验签、解密、执行并回传结果

## 2. 环境准备

建议准备以下运行环境：

- Node.js 20 及以上
- npm 10 及以上
- MySQL 8.x

首次部署或测试前，在仓库根目录执行：

```bash
npm install
```

初始化数据库：

```bash
mysql -uroot -p -h 127.0.0.1 < db/init.sql
```

默认数据库信息：

- 数据库名：`remote_client`
- 默认管理员账号：`admin`
- 默认密码：`ChangeMe123!`

生成密钥：

```bash
npm run auth:keygen:all
```

该命令会生成两套密钥：

- `localapp/keys/auth_private.pem` 和 `localapp/keys/auth_public.pem`
- `webserver/server/keys/webserver_sign_private.pem` 和 `webserver/server/keys/webserver_sign_public.pem`

同时会把服务端签名公钥复制一份到：

- `localapp/keys/webserver_sign_public.pem`

这是 `localapp` 用来验签服务端消息的公钥文件。

## 3. 测试环境使用说明

测试环境推荐直接使用源码方式启动，方便联调。

### 3.1 配置服务端

复制服务端环境变量模板：

```bash
cp webserver/server/.env.example webserver/server/.env
```

Windows PowerShell 可使用：

```powershell
Copy-Item webserver/server/.env.example webserver/server/.env
```

按实际环境修改以下关键项：

- `HTTP_PORT`
- `MYSQL_URL`
- `AGENT_SHARED_TOKEN`
- `SESSION_SECURE`
- `ALLOW_PUBLIC_REGISTRATION`
- `WEBSERVER_SIGN_PRIVATE_KEY_PATH`
- `WEBSERVER_SIGN_PUBLIC_KEY_PATH`

测试环境常见示例：

```env
HTTP_PORT=3100
MYSQL_URL=mysql://root:yourpassword@127.0.0.1:3306/remote_client
AGENT_SHARED_TOKEN=test-shared-token
SESSION_SECURE=false
ALLOW_PUBLIC_REGISTRATION=true
WEBSERVER_SIGN_PRIVATE_KEY_PATH=./keys/webserver_sign_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
```

### 3.2 配置 `localapp`

复制 agent 环境变量模板：

```bash
cp localapp/.env.example localapp/.env
```

Windows PowerShell 可使用：

```powershell
Copy-Item localapp/.env.example localapp/.env
```

按实际环境修改以下关键项：

- `SERVER_WS_URL`
- `AGENT_ID`
- `AGENT_LABEL`
- `AGENT_SHARED_TOKEN`
- `AUTH_PRIVATE_KEY_PATH`
- `WEBSERVER_SIGN_PUBLIC_KEY_PATH`
- `COMMON_WORK_DIRS`
- `ALLOWED_CWD_ROOTS`

测试环境常见示例：

```env
SERVER_WS_URL=ws://127.0.0.1:3100/ws/agent
AGENT_ID=test-agent-01
AGENT_LABEL=Test Agent 01
AGENT_SHARED_TOKEN=test-shared-token
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
DEFAULT_SHELL=powershell.exe
COMMON_WORK_DIRS=C:\workspace,C:\project\remote-client
ALLOWED_CWD_ROOTS=C:\workspace,C:\project\remote-client
LOCAL_DEBUG_SERVER_ENABLED=false
```

Linux 示例：

```env
SERVER_WS_URL=ws://127.0.0.1:3100/ws/agent
AGENT_ID=test-agent-01
AGENT_LABEL=Test Agent 01
AGENT_SHARED_TOKEN=test-shared-token
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
DEFAULT_SHELL=/bin/bash
COMMON_WORK_DIRS=/srv/workspace,/opt/project
ALLOWED_CWD_ROOTS=/srv/workspace,/opt/project
LOCAL_DEBUG_SERVER_ENABLED=false
```

说明：

- `COMMON_WORK_DIRS` 主要用于前端候选目录展示
- `ALLOWED_CWD_ROOTS` 用于限制终端会话启动目录范围
- 若 `ALLOWED_CWD_ROOTS` 为空，则不会启用启动目录白名单

### 3.3 启动测试环境

在仓库根目录分别启动以下进程。

启动服务端：

```bash
npm run dev:server
```

启动前端开发服务器：

```bash
npm run dev:client
```

启动 `localapp`：

```bash
npm run dev:agent
```

默认访问地址：

```text
http://127.0.0.1:5173
```

### 3.4 首次登录与绑定 `auth_code`

1. 打开浏览器访问 `http://127.0.0.1:5173`
2. 使用默认管理员账号登录
3. 进入“我的”页面中的公钥绑定区域
4. 选择当前在线设备，或填写 `agentId`
5. 打开 `localapp/keys/auth_public.pem`
6. 将完整公钥 PEM 内容粘贴到 `auth_code` 输入框
7. 保存绑定

如果没有为当前设备绑定 `auth_code`，前端无法发送安全命令，也无法创建远程终端会话。

### 3.5 测试环境验证步骤

推荐按以下顺序验证：

1. 在服务端确认 `/api/health` 可访问
2. 在前端确认可以登录
3. 确认设备列表里能看到目标 `agentId`
4. 录入该设备的 `auth_code`
5. 在“发现”页发送一次性命令，例如：

```text
hostname
```

Windows 也可使用：

```text
whoami
ipconfig /all
```

Linux 也可使用：

```text
whoami
uname -a
pwd
```

6. 创建一个交互式终端会话
7. 在终端中执行简单命令，确认输出能实时回传

### 3.6 可选：使用本地调试接口和 mock-client

这部分只建议用于开发联调，不建议作为生产方式。

若需要开启 `localapp` 本地调试接口，在 `localapp/.env` 中配置：

```env
LOCAL_DEBUG_SERVER_ENABLED=true
LOCAL_DEBUG_SERVER_HOST=127.0.0.1
LOCAL_DEBUG_SERVER_PORT=3210
LOCAL_DEBUG_TOKEN=your-local-debug-token
```

启动后可使用仓库根目录的辅助命令：

```bash
npm run mock:local:health
npm run mock:local:command
npm run mock:local:session
npm run mock:local:smoke
```

如果要走完整 Web 链路，也可以使用：

```bash
npm run mock:web:command
npm run mock:web:session
npm run mock:web:smoke
```

这些脚本需要按提示补充对应环境变量，例如：

- `LOCAL_DEBUG_TOKEN`
- `MOCK_USERNAME`
- `MOCK_PASSWORD`
- `MOCK_AGENT_ID`

## 4. 正式环境部署 `webserver`

生产环境推荐将 `webserver/server` 和构建后的 `webserver/client` 部署在同一台服务器上，由 Node.js 服务统一提供 API、WebSocket 和静态前端页面。

### 4.1 部署目标

生产环境 `webserver` 应提供以下能力：

- HTTP API
- `/ws/agent` 供 `localapp` 连接
- `/ws/browser` 供前端浏览器实时通信
- 前端静态页面

当前代码已支持在 `webserver/server` 中托管 `webserver/client/dist`，因此生产环境不需要单独再起一个前端 Node 进程。

### 4.2 生产环境准备

建议准备：

- Linux 服务器
- Node.js 20 及以上
- MySQL 8.x
- 反向代理，例如 Nginx
- 域名和 HTTPS 证书

### 4.3 初始化与构建

在部署机拉取代码后，执行：

```bash
npm install
mysql -uroot -p -h 127.0.0.1 < db/init.sql
npm run auth:keygen:all
npm run build:client
```

`npm run build:client` 完成后，前端文件会生成到：

- `webserver/client/dist`

服务端启动时会自动托管这个目录。

### 4.4 生产环境服务端配置

复制：

```bash
cp webserver/server/.env.example webserver/server/.env
```

生产环境建议至少调整以下配置：

```env
HTTP_PORT=3100
AGENT_SHARED_TOKEN=replace-with-strong-random-token
MYSQL_URL=mysql://remote_user:strong_password@127.0.0.1:3306/remote_client
SESSION_COOKIE_NAME=remote_client_session
SESSION_TTL_HOURS=24
SESSION_SECURE=true
ALLOW_PUBLIC_REGISTRATION=false
WEBSERVER_SIGN_PRIVATE_KEY_PATH=./keys/webserver_sign_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
LOG_LEVEL=info
LOG_DIR=logs
```

生产建议：

- `AGENT_SHARED_TOKEN` 使用高强度随机值
- `SESSION_SECURE=true`
- `ALLOW_PUBLIC_REGISTRATION=false`
- MySQL 使用独立账号，不使用 `root`
- 私钥文件仅允许服务账户读取

### 4.5 启动 `webserver/server`

直接启动：

```bash
npm run start --workspace webserver/server
```

也可以进入目录后启动：

```bash
cd webserver/server
npm start
```

建议使用 `systemd` 或 `pm2` 守护。下面给出 `systemd` 示例。

示例文件 `/etc/systemd/system/remote-webserver.service`：

```ini
[Unit]
Description=Remote Client Webserver
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/remote-client
ExecStart=/usr/bin/npm run start --workspace webserver/server
Restart=always
RestartSec=5
User=remote
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable remote-webserver
sudo systemctl start remote-webserver
sudo systemctl status remote-webserver
```

### 4.6 Nginx 反向代理示例

建议通过 Nginx 暴露 HTTPS，并把 WebSocket 一并转发到 Node 服务。

示例：

```nginx
server {
    listen 80;
    server_name remote.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name remote.example.com;

    ssl_certificate     /etc/letsencrypt/live/remote.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/remote.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/agent {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws/browser {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

注意：

- 上面的 `80 -> 443` 配置会把 `http://` 和 `ws://` 请求一起重定向到 HTTPS
- 如果 `localapp` 仍然配置为 `ws://remote.example.com/ws/agent`，握手可能直接收到 `301`，日志通常表现为 `Unexpected server response: 301`
- 这种情况下应把 `SERVER_WS_URL` 改成 `wss://remote.example.com/ws/agent`

### 4.7 生产环境验收

建议至少验证以下内容：

1. 浏览器可正常打开首页
2. 管理员账号可以登录
3. `/api/health` 返回正常
4. `localapp` 可连接到 `/ws/agent`
5. 浏览器实时更新正常
6. 完成一次 `auth_code` 绑定
7. 完成一次安全命令下发
8. 完成一次远程终端创建和交互

## 5. `localapp` 在 Windows 下部署

### 5.1 适用场景

适用于：

- 办公网机器
- 内网服务器
- 开发测试机
- Windows 虚拟机

### 5.2 运行前准备

建议安装：

- Node.js 20 及以上
- Visual C++ 运行库

由于项目依赖 `node-pty`，如果目标机器无法直接使用预编译包，可能需要具备本地编译环境。优先建议在测试机先执行一次 `npm install` 验证依赖是否可正常安装。

### 5.3 拷贝程序与配置

将仓库部署到目标目录，例如：

```text
C:\remote-client
```

安装依赖：

```powershell
cd C:\remote-client
npm install
```

复制配置：

```powershell
Copy-Item localapp\.env.example localapp\.env
```

根据实际生产环境修改 `localapp\.env`，示例：

```env
SERVER_WS_URL=wss://remote.example.com/ws/agent
AGENT_ID=office-win-01
AGENT_LABEL=Office Windows 01
AGENT_SHARED_TOKEN=replace-with-strong-random-token
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
DEFAULT_SHELL=powershell.exe
COMMON_WORK_DIRS=C:\workspace,C:\ops
ALLOWED_CWD_ROOTS=C:\workspace,C:\ops
LOG_LEVEL=info
LOG_DIR=logs
LOCAL_DEBUG_SERVER_ENABLED=false
```

说明：

- 如果服务端通过 HTTPS 暴露，`SERVER_WS_URL` 应使用 `wss://`
- 如果域名通过 Nginx/Caddy 等反向代理强制跳转 HTTPS，而 `SERVER_WS_URL` 仍写成 `ws://...`，`localapp` 会反复重连，并在日志中看到 `Unexpected server response: 301`
- `AGENT_ID` 必须稳定且唯一
- `AGENT_SHARED_TOKEN` 必须与服务端一致

### 5.4 生成或分发密钥

方式一，直接在仓库内生成：

```powershell
npm run auth:keygen:localapp
```

方式二，在其他机器生成后复制到以下位置：

- `localapp/keys/auth_private.pem`
- `localapp/keys/auth_public.pem`
- `localapp/keys/webserver_sign_public.pem`

注意：

- `auth_private.pem` 只能保存在该 agent 所在机器
- `auth_public.pem` 需要录入 Web 控制台的 `auth_code`
- `webserver_sign_public.pem` 必须来自正式环境服务端

### 5.5 手工启动

在仓库根目录执行：

```powershell
npm run start --workspace localapp
```

或进入目录执行：

```powershell
cd localapp
npm start
```

### 5.6 建议的后台运行方式

Windows 下建议通过以下任一方式守护：

- `pm2`
- NSSM
- Windows 任务计划程序

若使用 `pm2`，常见做法如下：

```powershell
npm install -g pm2
pm2 start npm --name remote-localapp -- run start --workspace localapp
pm2 save
```

验证：

```powershell
pm2 status
pm2 logs remote-localapp
```

### 5.7 首次接入步骤

1. 启动 `localapp`
2. 在 Web 控制台确认设备上线
3. 打开 `localapp/keys/auth_public.pem`
4. 在“我的 -> 公钥绑定”中为该 `agentId` 录入公钥
5. 发送一次简单命令验证

## 6. `localapp` 在 Linux 下部署

### 6.1 适用场景

适用于：

- 云主机
- Linux 服务器
- 内网跳板机
- 容器外的长期运行节点

### 6.2 安装运行环境

以 Ubuntu 为例：

```bash
sudo apt update
sudo apt install -y curl build-essential
```

安装 Node.js 20：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

确认版本：

```bash
node -v
npm -v
```

### 6.3 部署目录与权限

建议新建专用账户和目录：

```bash
sudo useradd -r -m -d /opt/remote-client remote || true
sudo mkdir -p /opt/remote-client
sudo chown -R remote:remote /opt/remote-client
```

将项目拷贝到：

```text
/opt/remote-client
```

然后安装依赖：

```bash
cd /opt/remote-client
npm install
```

### 6.4 配置 `localapp`

复制配置：

```bash
cp localapp/.env.example localapp/.env
```

生产示例：

```env
SERVER_WS_URL=wss://remote.example.com/ws/agent
AGENT_ID=prod-linux-01
AGENT_LABEL=Prod Linux 01
AGENT_SHARED_TOKEN=replace-with-strong-random-token
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
DEFAULT_SHELL=/bin/bash
COMMON_WORK_DIRS=/srv/workspace,/opt/jobs
ALLOWED_CWD_ROOTS=/srv/workspace,/opt/jobs
LOG_LEVEL=info
LOG_DIR=logs
LOCAL_DEBUG_SERVER_ENABLED=false
```

### 6.5 生成或分发密钥

生成：

```bash
npm run auth:keygen:localapp
```

或者把以下文件复制到 `localapp/keys/`：

- `auth_private.pem`
- `auth_public.pem`
- `webserver_sign_public.pem`

然后限制权限：

```bash
chmod 600 localapp/keys/auth_private.pem
chmod 644 localapp/keys/auth_public.pem
chmod 644 localapp/keys/webserver_sign_public.pem
```

### 6.6 手工启动

```bash
npm run start --workspace localapp
```

### 6.7 使用 systemd 守护

推荐使用 `systemd` 长期运行。

示例文件 `/etc/systemd/system/remote-localapp.service`：

```ini
[Unit]
Description=Remote Client Local Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/remote-client
ExecStart=/usr/bin/npm run start --workspace localapp
Restart=always
RestartSec=5
User=remote
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable remote-localapp
sudo systemctl start remote-localapp
sudo systemctl status remote-localapp
```

查看日志：

```bash
journalctl -u remote-localapp -f
```

### 6.8 首次接入步骤

1. 启动 `localapp`
2. 在 Web 控制台确认设备上线
3. 读取 `localapp/keys/auth_public.pem`
4. 在控制台中为该 `agentId` 建立 `auth_code` 绑定
5. 发送一次命令验证

## 7. 常见运维建议

### 7.1 服务端建议

- 强制使用 HTTPS
- `AGENT_SHARED_TOKEN` 使用高强度随机值
- 关闭公开注册：`ALLOW_PUBLIC_REGISTRATION=false`
- 定期备份 MySQL
- 私钥文件不要进入代码仓库

### 7.2 `localapp` 建议

- 每台机器使用唯一 `AGENT_ID`
- 每台机器保存自己的 `auth_private.pem`
- 控制 `COMMON_WORK_DIRS` 和 `ALLOWED_CWD_ROOTS`
- 非必要不要开启本地调试接口

### 7.3 安全注意事项

- `auth_private.pem` 和 `webserver_sign_private.pem` 都属于敏感文件
- `auth_public.pem` 是需要录入控制台的公钥，不是私钥
- 若服务端更换签名密钥，必须同步更新各台 `localapp` 的 `webserver_sign_public.pem`
- 若某台 agent 重建了自己的 RSA 密钥，需要重新在 Web 控制台录入新的 `auth_code`

## 8. 故障排查

### 8.1 浏览器打不开控制台

检查：

- `webserver/server` 是否启动
- 是否已执行 `npm run build:client`
- 反向代理是否正确转发

### 8.2 设备未上线

检查：

- `localapp` 是否已启动
- `SERVER_WS_URL` 是否正确
- 如果 `localapp/logs/agent.log` 出现 `Unexpected server response: 301`，通常表示当前用了 `ws://` 连接一个会强制跳转 HTTPS 的域名，应改成 `wss://`
- `AGENT_SHARED_TOKEN` 是否和服务端一致
- 服务器的 `/ws/agent` 是否可达

### 8.3 能看到设备，但不能发命令

检查：

- 当前用户是否为该 `agentId` 录入了 `auth_code`
- 录入的是否是 `localapp/keys/auth_public.pem`
- `localapp` 是否加载了正确的 `auth_private.pem`
- `localapp` 是否加载了正确的 `webserver_sign_public.pem`

### 8.4 终端会话创建失败

检查：

- `ALLOWED_CWD_ROOTS` 是否限制了启动目录
- `DEFAULT_SHELL` 是否存在
- `node-pty` 是否安装成功
- 目标主机是否具备对应 shell

### 8.5 服务端重启后的记录保留范围

当前持久化到 MySQL 的是：

- 用户
- 会话
- `auth_code`
- 一次性命令摘要
- 终端会话摘要
- AI 终端会话的多轮输入与提取结果

说明：

- 在线设备状态仍是内存态，服务端重启后会重新等待 agent 上线
- 一次性命令默认只持久化摘要字段，不保存完整 `stdout` / `stderr`
- AI 会话默认只持久化用户输入和提取出的 `final_text`，不会默认把完整思考流落库
