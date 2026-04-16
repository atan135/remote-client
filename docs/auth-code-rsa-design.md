# Auth Code + RSA 双向校验设计

## 目标

在现有 `webserver -> localapp` 命令下发链路上增加一层安全保护，满足两件事：

- 只有目标 `localapp` 能解开命令内容
- `localapp` 能确认消息确实来自官方 `webserver`

因此本方案不再只依赖一套密钥，而是拆成“加密密钥”和“签名密钥”两条链路。

## 最终确认结果

### 1. `auth_code` 独立存表

不再放在 `users.auth_code`。

原因：

- 一个用户可能对应多台 `localapp`
- 界面需要展示、增加、修改、删除多条绑定记录
- 后续还需要按 `agent` 精确找到用于加密的公钥

建议表名：

- `user_auth_codes`

建议字段：

```sql
CREATE TABLE user_auth_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL COMMENT '归属用户 ID',
  agent_id VARCHAR(128) NOT NULL COMMENT 'localapp agent 标识',
  auth_code LONGTEXT NOT NULL COMMENT 'localapp RSA public key PEM',
  remark VARCHAR(255) NULL COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_auth_codes_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  UNIQUE KEY uniq_user_agent (user_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

字段含义：

- `user_id`：这套密钥归属哪个控制台用户
- `agent_id`：这套公钥对应哪台 `localapp`
- `auth_code`：保存 PEM 格式 RSA 公钥
- `remark`：给用户看的描述，例如“办公室电脑”或“家中 NAS”

### 2. 两套密钥并行使用

本方案明确使用两套 RSA 密钥对。

#### 第一套：`localapp` 解密密钥

用途：

- `webserver` 用公钥加密命令
- `localapp` 用私钥解密命令

存放方式：

- 公钥保存在 `webserver` 的 `user_auth_codes.auth_code`
- 私钥只保存在 `localapp` 本地

这套解决的是：

- 只有目标 `localapp` 能看到明文命令

#### 第二套：`webserver` 签名密钥

用途：

- `webserver` 用私钥对消息签名
- `localapp` 用公钥验证签名

存放方式：

- 私钥只保存在 `webserver/server`
- 公钥分发到 `localapp`

这套解决的是：

- `localapp` 可以确认这条消息确实由 `webserver` 发出

### 为什么要两套密钥

如果只有第一套密钥，会存在一个问题：

- `localapp` 公钥本来就是公开信息
- 任何拿到这个公钥的人都能构造密文
- `localapp` 只能证明“我能解开”，不能证明“这条消息来自官方服务端”

所以最终方案必须同时具备：

- 加密链路：保护内容不被旁路读取
- 签名链路：保护消息来源不可伪造

## 密钥生成工具

本仓库新增一个通用 RSA 密钥生成工具：

- [scripts/generate-rsa-keypair.js](/c:/project/remote-client/scripts/generate-rsa-keypair.js)

根目录 `package.json` 已提供命令：

```bash
npm run auth:keygen:localapp
npm run auth:keygen:webserver
npm run auth:keygen:all
```

命令说明：

- `auth:keygen:localapp`
  生成 `localapp` 用于解密命令的密钥对
- `auth:keygen:webserver`
  生成 `webserver` 用于签名消息的密钥对
- `auth:keygen:all`
  顺序生成以上两套密钥

### 生成结果

执行 `npm run auth:keygen:localapp` 后，默认输出：

- `localapp/keys/auth_private.pem`
- `localapp/keys/auth_public.pem`

执行 `npm run auth:keygen:webserver` 后，默认输出：

- `webserver/server/keys/webserver_sign_private.pem`
- `webserver/server/keys/webserver_sign_public.pem`
- `localapp/keys/webserver_sign_public.pem`

说明：

- 这些目录已加入 `.gitignore`
- 工具会打印公钥内容、文件路径和 SHA-256 指纹
- `webserver` 公钥会额外导出一份到 `localapp/keys/`，方便本地开发直接验签
- 如果目标文件已存在，默认拒绝覆盖；需要重新生成时使用 `--force`

### 可选私钥口令

工具支持通过环境变量为私钥加口令：

- `AUTH_PRIVATE_KEY_PASSPHRASE`
- `WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE`

如果设置了对应环境变量，生成的私钥会以加密 PEM 格式写出。

## 环境变量设计

### `localapp/.env`

建议增加：

```env
AUTH_PRIVATE_KEY_PATH=./keys/auth_private.pem
AUTH_PRIVATE_KEY_PASSPHRASE=
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
```

含义：

- `AUTH_PRIVATE_KEY_PATH`
  `localapp` 自己的命令解密私钥路径
- `AUTH_PRIVATE_KEY_PASSPHRASE`
  如果私钥带口令，则这里提供解锁口令
- `WEBSERVER_SIGN_PUBLIC_KEY_PATH`
  `webserver` 签名公钥路径，供 `localapp` 验签

### `webserver/server/.env`

建议增加：

```env
WEBSERVER_SIGN_PRIVATE_KEY_PATH=./keys/webserver_sign_private.pem
WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE=
WEBSERVER_SIGN_PUBLIC_KEY_PATH=./keys/webserver_sign_public.pem
```

含义：

- `WEBSERVER_SIGN_PRIVATE_KEY_PATH`
  `webserver` 自己用于签名的私钥路径
- `WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE`
  如果签名私钥带口令，则这里提供解锁口令
- `WEBSERVER_SIGN_PUBLIC_KEY_PATH`
  服务端保留自己的公钥文件，方便导出给 `localapp`

## web 端界面要求

`webserver/client` 需要增加一套 `auth_code` 管理界面，面向用户展示和维护自己的绑定关系。

建议能力：

- 列表展示当前用户的所有 `auth_code` 记录
- 新增一条绑定记录
- 修改 `agent_id`、`auth_code`、`remark`
- 删除绑定记录
- 在详情中展示公钥指纹，避免完整公钥过长难以辨识

建议表单字段：

- `agent_id`
- `auth_code`
- `remark`

建议交互流程：

1. 用户在本地执行 `npm run auth:keygen:localapp`
2. 复制 `auth_public.pem` 内容
3. 登录 `webserver`
4. 在 `auth_code` 管理页新增绑定
5. 填写目标 `agent_id`
6. 粘贴公钥到 `auth_code`
7. 保存后由服务端写入 `user_auth_codes`

## 命令安全下发流程

### 当前链路

1. 浏览器提交命令
2. `webserver/server` 把明文命令推给 `localapp`
3. `localapp` 直接执行

### 改造后链路

1. 浏览器提交命令
2. `webserver/server` 根据当前登录用户和目标 `agent_id` 查询 `user_auth_codes`
3. 服务端读取该记录的 `auth_code` 作为加密公钥
4. 服务端随机生成一次性 AES 密钥
5. 服务端用 AES-256-GCM 加密真实命令载荷
6. 服务端用 `localapp` 公钥加密这把 AES 密钥
7. 服务端使用自己的签名私钥对消息摘要签名
8. 服务端把“加密命令包 + 签名”发送给 `localapp`
9. `localapp` 使用 `WEBSERVER_SIGN_PUBLIC_KEY_PATH` 先验签
10. 验签通过后，使用本地私钥解密 AES 密钥
11. 使用 AES 密钥解密命令明文
12. 校验通过后执行命令
13. 执行结果仍按现有链路回传

## 推荐消息结构

### server -> localapp

建议从当前 `command.execute` 扩展为安全版本：

```json
{
  "type": "command.execute.secure",
  "payload": {
    "requestId": "uuid",
    "agentId": "office-pc-01",
    "operatorUserId": 12,
    "authCodeId": 5,
    "encryptKeyVersion": 1,
    "signKeyVersion": 1,
    "algorithm": {
      "asymmetric": "RSA-OAEP-256",
      "symmetric": "AES-256-GCM",
      "signature": "RSA-SHA256"
    },
    "encryptedKey": "base64",
    "iv": "base64",
    "tag": "base64",
    "ciphertext": "base64",
    "signature": "base64"
  },
  "sentAt": "2026-04-16T12:00:00.000Z"
}
```

签名规则建议：

- 签名输入不包含 `signature` 字段自身
- 采用固定字段顺序进行序列化
- 推荐以 `requestId + agentId + authCodeId + encryptKeyVersion + signKeyVersion + encryptedKey + iv + tag + ciphertext + sentAt` 组成稳定签名串

### localapp 解密后的明文载荷

```json
{
  "requestId": "uuid",
  "agentId": "office-pc-01",
  "command": "ipconfig /all",
  "createdAt": "2026-04-16T12:00:00.000Z",
  "issuedAt": "2026-04-16T12:00:00.000Z",
  "expiresAt": "2026-04-16T12:01:00.000Z",
  "nonce": "uuid"
}
```

## 为什么仍然推荐“混合加密”

即使已经有两套 RSA 密钥，也不建议直接用 RSA 加密整条命令。

原因：

- RSA 不适合承载任意长度明文
- 命令字符串和扩展字段一长就可能超过限制
- 纯 RSA 会让后续协议扩展非常被动

因此推荐：

1. 随机生成一次性 AES 密钥
2. 用 AES-GCM 加密真实命令体
3. 再用 `localapp` 公钥加密 AES 密钥
4. `localapp` 解开 AES 密钥后再解密命令体

## localapp 执行前校验

`localapp` 在执行前至少做以下检查：

1. 成功加载 `webserver` 公钥
2. 验签成功
3. 成功加载本地私钥
4. 成功解密消息
5. `agentId` 与本机配置一致
6. `expiresAt` 未超时
7. `nonce` 未被重复使用
8. 解密后的 `command` 非空

如果任一环节失败：

- 记录安全日志
- 拒绝执行
- 回传 `command.finished`
- 状态记为 `failed`

## 日志建议

### webserver/server

记录：

- 当前用户和目标 `agent_id`
- 是否找到对应的 `auth_code`
- 使用了哪条 `auth_code` 记录
- 加密成功或失败
- 签名成功或失败
- 推送给哪个 `agent`

注意：

- 不记录完整私钥
- 公钥建议只记录指纹和记录 ID

### localapp

记录：

- 是否成功加载 `WEBSERVER_SIGN_PUBLIC_KEY_PATH`
- 验签成功或失败
- 是否成功加载 `AUTH_PRIVATE_KEY_PATH`
- 是否成功解密消息
- 解密失败或校验失败的原因
- 最终是否进入执行阶段

注意：

- 不记录完整私钥
- 验签失败时建议记录签名版本和消息摘要标识

## 本期落地拆分

### 第一阶段

- 更新数据库设计为 `user_auth_codes`
- 增加前端 `auth_code` 绑定记录 CRUD
- 增加 RSA 密钥生成工具
- 补充 `.env.example` 和文档

### 第二阶段

- `webserver/server` 加密命令包
- `webserver/server` 对消息签名
- `localapp` 先验签再解密
- 引入 `nonce` 去重和超时控制

## 当前状态

当前仓库已完成：

- 双端安全方案文档
- 独立 `auth_code` 数据模型设计
- 两套密钥职责定义
- RSA 密钥生成工具与根目录命令入口

当前尚未完成：

- 数据表实际创建
- 前端 CRUD 页面
- 服务端签名和加密发送
- `localapp` 验签和解密执行
