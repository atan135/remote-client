import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import cookie from "cookie";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";

import { AuthCodeService } from "./auth/auth-code-service.js";
import { SessionService } from "./auth/session-service.js";
import { UserService } from "./auth/user-service.js";
import { loadConfig } from "./config.js";
import { createMysqlPool } from "./db/mysql.js";
import { configureLogging, logEvent } from "./logger.js";
import { BrowserHub } from "./realtime/browser-hub.js";
import { SecureCommandService } from "./security/secure-command-service.js";
import { AgentRegistry } from "./state/agent-registry.js";
import { CommandStore } from "./state/command-store.js";
import { TerminalSessionStore } from "./state/terminal-session-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = loadConfig();
const loggers = configureLogging(config);
const { serverLogger, commandLogger } = loggers;
const pool = createMysqlPool(config);
const userService = new UserService(pool);
const authCodeService = new AuthCodeService(pool);
const sessionService = new SessionService(pool, config);
const secureCommandService = new SecureCommandService(config);
const app = express();
const server = http.createServer(app);
const agentRegistry = new AgentRegistry();
const commandStore = new CommandStore(config.commandHistoryLimit);
const terminalSessionStore = new TerminalSessionStore(
  config.terminalSessionHistoryLimit,
  config.terminalSessionOutputLimit
);
const browserHub = new BrowserHub();
const commandDispatchContextSymbol = Symbol("commandDispatchContext");

const agentSocketServer = new WebSocketServer({ noServer: true });
const browserSocketServer = new WebSocketServer({ noServer: true });

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/config", async (_req, res) => {
  res.json({
    authEnabled: true,
    allowPublicRegistration: config.allowPublicRegistration
  });
});

app.get("/api/auth/session", requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    user: req.auth.user
  });
});

app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (!username || !password) {
    res.status(400).json({ message: "username and password are required" });
    return;
  }

  try {
    const user = await userService.authenticate(username, password);

    if (!user) {
      logEvent(serverLogger, "warn", "auth.login_failed", {
        username,
        ...getRequestContext(req)
      });
      res.status(401).json({ message: "用户名或密码错误" });
      return;
    }

    const session = await sessionService.createSession({
      userId: user.id,
      ...getRequestContext(req)
    });

    setSessionCookie(res, session.sessionToken, session.expiresAt);

    logEvent(serverLogger, "info", "auth.login_succeeded", {
      userId: user.id,
      username: user.username,
      ...getRequestContext(req)
    });

    res.json({
      authenticated: true,
      user
    });
  } catch (error) {
    logEvent(serverLogger, "error", "auth.login_error", {
      username,
      error: error.message
    });
    res.status(500).json({ message: "登录失败" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  if (!config.allowPublicRegistration) {
    res.status(403).json({ message: "当前未开放注册" });
    return;
  }

  const payload = normalizeUserPayload(req.body);
  const password = String(req.body?.password || "");

  if (!payload.username || !payload.displayName || !isValidPassword(password)) {
    res.status(400).json({ message: "请填写有效的用户名、显示名和密码" });
    return;
  }

  try {
    if (await userService.usernameExists(payload.username)) {
      res.status(409).json({ message: "用户名已存在" });
      return;
    }

    const user = await userService.register({
      username: payload.username,
      displayName: payload.displayName,
      password,
      role: "operator"
    });

    logEvent(serverLogger, "info", "auth.register_succeeded", {
      userId: user.id,
      username: user.username,
      ...getRequestContext(req)
    });

    res.status(201).json({
      item: user
    });
  } catch (error) {
    logEvent(serverLogger, "error", "auth.register_error", {
      username: payload.username,
      error: error.message
    });
    res.status(500).json({ message: "注册失败" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const sessionToken = getSessionTokenFromRequest(req);

  try {
    await sessionService.deleteSession(sessionToken);
  } catch (error) {
    logEvent(serverLogger, "error", "auth.logout_error", {
      error: error.message
    });
  }

  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!currentPassword || !isValidPassword(newPassword)) {
    res.status(400).json({ message: "请填写当前密码和有效的新密码" });
    return;
  }

  try {
    const result = await userService.changePassword(
      req.auth.user.id,
      currentPassword,
      newPassword
    );

    if (!result.ok) {
      res.status(400).json({ message: "当前密码错误" });
      return;
    }

    await sessionService.deleteSessionsByUserId(req.auth.user.id);
    clearSessionCookie(res);

    logEvent(serverLogger, "info", "auth.password_changed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      ...getRequestContext(req)
    });

    res.json({ ok: true });
  } catch (error) {
    logEvent(serverLogger, "error", "auth.change_password_error", {
      userId: req.auth.user.id,
      error: error.message
    });
    res.status(500).json({ message: "修改密码失败" });
  }
});

app.get("/api/users", requireAdmin, async (_req, res) => {
  const items = await userService.listUsers();
  res.json({ items });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const payload = normalizeUserPayload(req.body);
  const password = String(req.body?.password || "");
  const role = normalizeRole(req.body?.role);
  const isActive = req.body?.isActive !== false;

  if (!payload.username || !payload.displayName || !role || !isValidPassword(password)) {
    res.status(400).json({ message: "请填写有效的用户信息和密码" });
    return;
  }

  if (await userService.usernameExists(payload.username)) {
    res.status(409).json({ message: "用户名已存在" });
    return;
  }

  const user = await userService.createUser({
    username: payload.username,
    displayName: payload.displayName,
    password,
    role,
    isActive
  });

  logEvent(serverLogger, "info", "admin.user_created", {
    actorUserId: req.auth.user.id,
    actorUsername: req.auth.user.username,
    userId: user.id,
    username: user.username
  });

  res.status(201).json({ item: user });
});

app.patch("/api/users/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const existing = await userService.findUserById(userId);

  if (!existing) {
    res.status(404).json({ message: "用户不存在" });
    return;
  }

  const displayName = String(req.body?.displayName || "").trim();
  const role = normalizeRole(req.body?.role);
  const isActive = req.body?.isActive !== false;

  if (!displayName || !role) {
    res.status(400).json({ message: "请填写有效的显示名和角色" });
    return;
  }

  if (existing.id === req.auth.user.id && !isActive) {
    res.status(400).json({ message: "不能禁用当前登录账号" });
    return;
  }

  const user = await userService.updateUser(userId, {
    displayName,
    role,
    isActive
  });

  if (!isActive) {
    await sessionService.deleteSessionsByUserId(userId);
  }

  logEvent(serverLogger, "info", "admin.user_updated", {
    actorUserId: req.auth.user.id,
    actorUsername: req.auth.user.username,
    userId: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive
  });

  res.json({ item: user });
});

app.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const newPassword = String(req.body?.newPassword || "");
  const user = await userService.findUserById(userId);

  if (!user) {
    res.status(404).json({ message: "用户不存在" });
    return;
  }

  if (!isValidPassword(newPassword)) {
    res.status(400).json({ message: "请输入有效的新密码" });
    return;
  }

  await userService.adminSetPassword(userId, newPassword);
  await sessionService.deleteSessionsByUserId(userId);

  logEvent(serverLogger, "info", "admin.password_reset", {
    actorUserId: req.auth.user.id,
    actorUsername: req.auth.user.username,
    userId: user.id,
    username: user.username
  });

  res.json({ ok: true });
});

app.get("/api/auth-codes", requireAuth, async (req, res) => {
  try {
    const items = await authCodeService.listByUserId(req.auth.user.id);
    res.json({ items });
  } catch (error) {
    logEvent(serverLogger, "error", "auth_code.list_failed", {
      userId: req.auth.user.id,
      error: error.message
    });
    res.status(500).json({ message: "加载授权密钥失败" });
  }
});

app.post("/api/auth-codes", requireAuth, async (req, res) => {
  try {
    const item = await authCodeService.create({
      userId: req.auth.user.id,
      agentId: req.body?.agentId,
      authCode: req.body?.authCode,
      remark: req.body?.remark
    });

    logEvent(serverLogger, "info", "auth_code.created", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId: item.id,
      agentId: item.agentId,
      fingerprint: item.fingerprint
    });

    res.status(201).json({ item });
  } catch (error) {
    const duplicate = isDuplicateEntryError(error);

    logEvent(serverLogger, duplicate ? "warn" : "error", "auth_code.create_failed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      agentId: String(req.body?.agentId || ""),
      error: error.message
    });

    res.status(duplicate ? 409 : 400).json({
      message: duplicate ? "同一设备只能保存一条授权密钥" : error.message || "创建授权密钥失败"
    });
  }
});

app.patch("/api/auth-codes/:id", requireAuth, async (req, res) => {
  const authCodeId = Number(req.params.id);

  try {
    const existing = await authCodeService.findByIdForUser(req.auth.user.id, authCodeId);

    if (!existing) {
      res.status(404).json({ message: "授权密钥不存在" });
      return;
    }

    const item = await authCodeService.update(authCodeId, req.auth.user.id, {
      agentId: req.body?.agentId,
      authCode: req.body?.authCode,
      remark: req.body?.remark
    });

    logEvent(serverLogger, "info", "auth_code.updated", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId: item.id,
      agentId: item.agentId,
      fingerprint: item.fingerprint
    });

    res.json({ item });
  } catch (error) {
    const duplicate = isDuplicateEntryError(error);

    logEvent(serverLogger, duplicate ? "warn" : "error", "auth_code.update_failed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId,
      error: error.message
    });

    res.status(duplicate ? 409 : 400).json({
      message: duplicate ? "同一设备只能保存一条授权密钥" : error.message || "更新授权密钥失败"
    });
  }
});

app.delete("/api/auth-codes/:id", requireAuth, async (req, res) => {
  const authCodeId = Number(req.params.id);

  try {
    const removed = await authCodeService.delete(authCodeId, req.auth.user.id);

    if (!removed) {
      res.status(404).json({ message: "授权密钥不存在" });
      return;
    }

    logEvent(serverLogger, "info", "auth_code.deleted", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId: removed.id,
      agentId: removed.agentId,
      fingerprint: removed.fingerprint
    });

    res.json({ ok: true });
  } catch (error) {
    logEvent(serverLogger, "error", "auth_code.delete_failed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId,
      error: error.message
    });
    res.status(500).json({ message: "删除授权密钥失败" });
  }
});

app.get("/api/agents", requireAuth, (req, res) => {
  res.json({ items: agentRegistry.list() });
});

app.get("/api/commands", requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || config.commandHistoryLimit;

  res.json({
    items: commandStore.list({
      agentId: req.query.agentId || "",
      limit
    })
  });
});

app.post("/api/commands", requireAuth, (req, res) => {
  void handleCommandRequest(req, res);
});

app.get("/api/terminal-sessions", requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || config.terminalSessionHistoryLimit;
  res.json({
    items: terminalSessionStore.list(limit)
  });
});

app.get("/api/terminal-sessions/:sessionId", requireAuth, (req, res) => {
  const session = terminalSessionStore.get(String(req.params.sessionId || ""));

  if (!session) {
    res.status(404).json({ message: "会话不存在" });
    return;
  }

  res.json({ item: session });
});

app.post("/api/terminal-sessions", requireAuth, (req, res) => {
  void handleTerminalSessionCreateRequest(req, res);
});

app.post("/api/terminal-sessions/:sessionId/input", requireAuth, (req, res) => {
  void handleTerminalSessionInputRequest(req, res);
});

app.post("/api/terminal-sessions/:sessionId/terminate", requireAuth, (req, res) => {
  void handleTerminalSessionTerminateRequest(req, res);
});

async function handleCommandRequest(req, res) {
  const command = String(req.body?.command || "").trim();
  const agentId = String(req.body?.agentId || "").trim();

  if (!agentId || !command) {
    logEvent(commandLogger, "warn", "command.invalid_request", {
      ...getRequestContext(req),
      agentId,
      command
    });
    res.status(400).json({ message: "agentId and command are required" });
    return;
  }

  try {
    const authCodeBinding = await authCodeService.findByUserIdAndAgentId(req.auth.user.id, agentId);

    if (!authCodeBinding) {
      logEvent(commandLogger, "warn", "command.auth_code_missing", {
        agentId,
        command,
        userId: req.auth.user.id,
        username: req.auth.user.username,
        ...getRequestContext(req)
      });
      res.status(400).json({ message: "当前用户未为该设备配置 auth_code" });
      return;
    }

    const record = commandStore.create({
      agentId,
      command,
      metadata: {
        operatorUserId: req.auth.user.id,
        operatorUsername: req.auth.user.username,
        authCodeId: authCodeBinding.id,
        authCodeFingerprint: authCodeBinding.fingerprint,
        authCodeRemark: authCodeBinding.remark,
        secureStatus: "pending",
        securityError: ""
      }
    });
    storeCommandDispatchContext(record, {
      user: req.auth.user,
      authCodeBinding
    });
    const dispatchResult = dispatchCommand(record, {
      user: req.auth.user,
      authCodeBinding
    });
    const queued = dispatchResult === "queued";

    logEvent(commandLogger, "info", "command.requested", {
      requestId: record.requestId,
      agentId,
      command,
      queued,
      dispatchResult,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      authCodeId: authCodeBinding.id,
      authCodeFingerprint: authCodeBinding.fingerprint,
      ...getRequestContext(req)
    });

    browserHub.broadcast("command.updated", record);

    if (dispatchResult === "failed") {
      res.status(500).json({
        message: record.error || "命令安全封装失败",
        item: record,
        queued: false
      });
      return;
    }

    res.status(dispatchResult === "dispatched" ? 202 : 201).json({
      item: record,
      queued
    });
  } catch (error) {
    logEvent(commandLogger, "error", "command.request_failed", {
      agentId,
      command,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message,
      ...getRequestContext(req)
    });
    res.status(500).json({ message: error.message || "命令提交失败" });
  }
}

async function handleTerminalSessionCreateRequest(req, res) {
  const agentId = String(req.body?.agentId || "").trim();
  const profile = String(req.body?.profile || "").trim();
  const launchPayload = {
    cwd: String(req.body?.cwd || "").trim(),
    env: isPlainObject(req.body?.env) ? req.body.env : {},
    cols: Number(req.body?.cols) || 120,
    rows: Number(req.body?.rows) || 30
  };

  if (!agentId || !profile) {
    res.status(400).json({ message: "agentId and profile are required" });
    return;
  }

  const socket = agentRegistry.getSocket(agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    res.status(409).json({ message: "目标 agent 当前不在线" });
    return;
  }

  try {
    const authCodeBinding = await authCodeService.findByUserIdAndAgentId(req.auth.user.id, agentId);

    if (!authCodeBinding) {
      res.status(400).json({ message: "当前用户未为该设备配置 auth_code" });
      return;
    }

    const record = terminalSessionStore.create({
      agentId,
      profile,
      metadata: {
        operatorUserId: req.auth.user.id,
        operatorUsername: req.auth.user.username,
        authCodeId: authCodeBinding.id,
        authCodeFingerprint: authCodeBinding.fingerprint,
        authCodeRemark: authCodeBinding.remark,
        cwd: launchPayload.cwd,
        envKeys: Object.keys(launchPayload.env),
        cols: launchPayload.cols,
        rows: launchPayload.rows
      }
    });
    const dispatchResult = dispatchTerminalSessionCreate(record, {
      user: req.auth.user,
      authCodeBinding,
      launchPayload
    });

    logEvent(commandLogger, "info", "terminal.session.requested", {
      sessionId: record.sessionId,
      requestId: record.requestId,
      agentId,
      profile,
      dispatchResult,
      userId: req.auth.user.id,
      username: req.auth.user.username
    });

    browserHub.broadcast("terminal.session.updated", record);

    if (dispatchResult === "failed") {
      res.status(500).json({
        message: record.error || "终端会话下发失败",
        item: record
      });
      return;
    }

    res.status(202).json({ item: record });
  } catch (error) {
    logEvent(commandLogger, "error", "terminal.session.request_failed", {
      agentId,
      profile,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message
    });
    res.status(500).json({ message: error.message || "终端会话创建失败" });
  }
}

async function handleTerminalSessionInputRequest(req, res) {
  const sessionId = String(req.params.sessionId || "");
  const input = String(req.body?.input || "");

  try {
    await dispatchTerminalSessionInputForUser({
      user: req.auth.user,
      sessionId,
      input
    });
    res.status(202).json({
      ok: true,
      sessionId
    });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ message: error.message || "会话输入下发失败" });
  }
}

async function handleTerminalSessionTerminateRequest(req, res) {
  const sessionId = String(req.params.sessionId || "");
  const session = terminalSessionStore.get(sessionId);

  if (!session) {
    res.status(404).json({ message: "会话不存在" });
    return;
  }

  if (isTerminalSessionClosedStatus(session.status)) {
    res.status(409).json({ message: "会话已关闭" });
    return;
  }

  const socket = agentRegistry.getSocket(session.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    res.status(409).json({ message: "目标 agent 当前不在线" });
    return;
  }

  try {
    const authCodeBinding = await authCodeService.findByUserIdAndAgentId(
      req.auth.user.id,
      session.agentId
    );

    if (!authCodeBinding) {
      res.status(400).json({ message: "当前用户未为该设备配置 auth_code" });
      return;
    }

    dispatchTerminalSessionTerminate(session, {
      user: req.auth.user,
      authCodeBinding
    });
    terminalSessionStore.update(sessionId, {
      status: "terminating"
    });
    browserHub.broadcast("terminal.session.updated", terminalSessionStore.get(sessionId));

    res.status(202).json({
      ok: true,
      sessionId
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "会话终止下发失败" });
  }
}

const clientDistPath = path.resolve(__dirname, "../../client/dist");

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get(/^(?!\/api)(?!\/ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/ws/agent") {
    if (!authorizeAgentRequest(url)) {
      logEvent(serverLogger, "warn", "agent.websocket_unauthorized", {
        agentId: url.searchParams.get("agentId") || "",
        ipAddress: request.socket.remoteAddress || ""
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    agentSocketServer.handleUpgrade(request, socket, head, (ws) => {
      agentSocketServer.emit("connection", ws, request, url);
    });
    return;
  }

  if (url.pathname === "/ws/browser") {
    const auth = await resolveRequestAuth(request);

    if (!auth) {
      logEvent(serverLogger, "warn", "browser.websocket_unauthorized", {
        ipAddress: request.socket.remoteAddress || "",
        userAgent: request.headers["user-agent"] || ""
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    browserSocketServer.handleUpgrade(request, socket, head, (ws) => {
      ws.auth = auth;
      browserSocketServer.emit("connection", ws);
    });
    return;
  }

  socket.destroy();
});

agentSocketServer.on("connection", (socket, _request, url) => {
  const agentId = url.searchParams.get("agentId") || "";

  logEvent(serverLogger, "info", "agent.websocket_connected", {
    agentId
  });

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw));
      handleAgentMessage(agentId, socket, message);
    } catch (error) {
      logEvent(serverLogger, "error", "agent.invalid_message", {
        agentId,
        error: error.message,
        raw: String(raw)
      });
    }
  });

  socket.on("close", () => {
    const agent = agentRegistry.disconnect(agentId);
    const changedCommands = commandStore.markAgentDisconnected(agentId);
    const changedSessions = terminalSessionStore.markAgentDisconnected(agentId);

    logEvent(serverLogger, "warn", "agent.websocket_disconnected", {
      agentId,
      affectedCommands: changedCommands.length,
      affectedSessions: changedSessions.length
    });

    if (agent) {
      browserHub.broadcast("agent.updated", agent);
    }

    for (const command of changedCommands) {
      browserHub.broadcast("command.updated", command);
    }

    for (const session of changedSessions) {
      browserHub.broadcast("terminal.session.updated", session);
    }
  });
});

browserSocketServer.on("connection", (socket) => {
  browserHub.add(socket);
  logEvent(serverLogger, "info", "browser.websocket_connected", {
    userId: socket.auth.user.id,
    username: socket.auth.user.username,
    subscribers: browserHub.sockets.size
  });
  browserHub.send(socket, "snapshot", {
    agents: agentRegistry.list(),
    commands: commandStore.list({
      agentId: "",
      limit: config.commandHistoryLimit
    }),
    terminalSessions: terminalSessionStore.list(config.terminalSessionHistoryLimit)
  });

  socket.on("message", (raw) => {
    void handleBrowserMessage(socket, raw);
  });

  socket.on("close", () => {
    browserHub.remove(socket);
    logEvent(serverLogger, "info", "browser.websocket_disconnected", {
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      subscribers: browserHub.sockets.size
    });
  });
});

async function bootstrap() {
  try {
    await pool.query("SELECT 1");
    await ensureUserAuthCodesTable();
    await sessionService.purgeExpiredSessions();
    try {
      const signingKeyInfo = secureCommandService.getSigningKeyInfo();
      logEvent(serverLogger, "info", "security.signing_key_ready", {
        fingerprint: signingKeyInfo.fingerprint,
        publicKeyPath: config.webserverSignPublicKeyPath
      });
    } catch (error) {
      logEvent(serverLogger, "warn", "security.signing_key_unavailable", {
        error: error.message
      });
    }

    server.listen(config.httpPort, () => {
      logEvent(serverLogger, "info", "server.started", {
        httpPort: config.httpPort,
        logDir: loggers.logDir
      });
    });
  } catch (error) {
    logEvent(serverLogger, "error", "server.bootstrap_failed", {
      error: error.message
    });
    process.exitCode = 1;
  }
}

bootstrap();

process.on("uncaughtException", (error) => {
  logEvent(serverLogger, "error", "process.uncaught_exception", {
    error: error.message,
    stack: error.stack || ""
  });
});

process.on("unhandledRejection", (reason) => {
  logEvent(serverLogger, "error", "process.unhandled_rejection", {
    reason: formatUnknownError(reason)
  });
});

function handleAgentMessage(agentId, socket, message) {
  if (message.type === "agent.register") {
    const agent = agentRegistry.register(message.payload, socket);
    logEvent(serverLogger, "info", "agent.registered", {
      agentId: agent.agentId,
      label: agent.label,
      hostname: agent.hostname,
      platform: agent.platform,
      arch: agent.arch,
      commonWorkingDirectoryCount: agent.commonWorkingDirectories.length
    });
    browserHub.broadcast("agent.updated", agent);
    dispatchQueuedCommands(agentId);
    return;
  }

  if (message.type === "agent.heartbeat") {
    const agent = agentRegistry.heartbeat(agentId);

    if (agent) {
      browserHub.broadcast("agent.updated", agent);
    }

    return;
  }

  if (message.type === "command.started") {
    const record = commandStore.update(message.payload.requestId, {
      status: "running",
      secureStatus: message.payload.secureStatus || "verified",
      startedAt: message.payload.startedAt || new Date().toISOString()
    });

    if (record) {
      logEvent(commandLogger, "info", "command.started", {
        requestId: record.requestId,
        agentId: record.agentId,
        command: record.command,
        startedAt: record.startedAt
      });
      browserHub.broadcast("command.updated", record);
    }

    return;
  }

  if (message.type === "command.finished") {
    const record = commandStore.update(message.payload.requestId, {
      status: message.payload.status,
      secureStatus: message.payload.secureStatus || inferSecureStatusFromResult(message.payload),
      exitCode: message.payload.exitCode,
      stdout: message.payload.stdout || "",
      stderr: message.payload.stderr || "",
      error: message.payload.error || "",
      securityError: message.payload.securityError || "",
      startedAt: message.payload.startedAt || null,
      completedAt: message.payload.completedAt || new Date().toISOString()
    });

    if (record) {
      logEvent(
        commandLogger,
        record.status === "completed" ? "info" : "warn",
        "command.finished",
        {
          requestId: record.requestId,
          agentId: record.agentId,
          command: record.command,
          status: record.status,
          exitCode: record.exitCode,
          stdout: record.stdout,
          stderr: record.stderr,
          error: record.error,
          secureStatus: record.secureStatus,
          securityError: record.securityError,
          startedAt: record.startedAt,
          completedAt: record.completedAt
        }
      );
      browserHub.broadcast("command.updated", record);
    }

    return;
  }

  if (message.type === "terminal.session.created") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      status: "running",
      startedAt: message.payload.startedAt || new Date().toISOString(),
      pid: message.payload.pid ?? null,
      error: ""
    });

    if (record) {
      browserHub.broadcast("terminal.session.updated", record);
    }

    return;
  }

  if (message.type === "terminal.session.output") {
    const result = terminalSessionStore.appendOutput(message.payload.sessionId, message.payload);

    if (result) {
      browserHub.broadcast("terminal.session.output", result.output);
      browserHub.broadcast("terminal.session.updated", result.record);
    }

    return;
  }

  if (message.type === "terminal.session.closed") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      status: message.payload.status || "completed",
      exitCode: message.payload.exitCode ?? null,
      error: message.payload.error || "",
      closedAt: message.payload.closedAt || new Date().toISOString()
    });

    if (record) {
      browserHub.broadcast("terminal.session.updated", record);
    }

    return;
  }

  if (message.type === "terminal.session.error") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      status: "failed",
      error: message.payload.error || "terminal session failed"
    });

    if (record) {
      browserHub.broadcast("terminal.session.updated", record);
    }
  }
}

function dispatchQueuedCommands(agentId) {
  for (const command of commandStore.listQueued(agentId)) {
    dispatchCommand(command, loadCommandDispatchContext(command));
  }
}

function dispatchCommand(command, context = loadCommandDispatchContext(command)) {
  const socket = agentRegistry.getSocket(command.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logEvent(commandLogger, "info", "command.queued", {
      requestId: command.requestId,
      agentId: command.agentId,
      command: command.command
    });
    return "queued";
  }

  if (!context?.user?.id || !context?.authCodeBinding?.authCode) {
    const error = "命令缺少可用的 auth_code 快照，无法安全派发";
    const failedRecord = commandStore.update(command.requestId, {
      status: "failed",
      secureStatus: "missing_auth_code_snapshot",
      securityError: error,
      error,
      completedAt: new Date().toISOString()
    });

    logEvent(commandLogger, "error", "command.dispatch_context_missing", {
      requestId: command.requestId,
      agentId: command.agentId,
      command: command.command,
      userId: command.operatorUserId,
      username: command.operatorUsername,
      authCodeId: command.authCodeId
    });

    if (failedRecord) {
      browserHub.broadcast("command.updated", failedRecord);
    }

    return "failed";
  }

  let secureEnvelope;
  try {
    secureEnvelope = secureCommandService.createSecureEnvelope({
      commandRecord: command,
      operatorUser: context.user,
      authCodeBinding: context.authCodeBinding
    });
  } catch (error) {
    const failedRecord = commandStore.update(command.requestId, {
      status: "failed",
      secureStatus: "failed_to_encrypt",
      securityError: error.message,
      error: error.message,
      completedAt: new Date().toISOString()
    });

    logEvent(commandLogger, "error", "command.secure_dispatch_failed", {
      requestId: command.requestId,
      agentId: command.agentId,
      command: command.command,
      userId: command.operatorUserId,
      username: command.operatorUsername,
      authCodeId: command.authCodeId,
      authCodeFingerprint: command.authCodeFingerprint,
      error: error.message
    });

    if (failedRecord) {
      browserHub.broadcast("command.updated", failedRecord);
    }

    return false;
  }

  const dispatchedAt = secureEnvelope.sentAt;

  commandStore.update(command.requestId, {
    status: "dispatched",
    secureStatus: "encrypted",
    securityError: "",
    dispatchedAt,
    error: "",
    expiresAt: secureEnvelope.meta.expiresAt,
    webserverSignFingerprint: secureEnvelope.meta.webserverSignFingerprint
  });

  logEvent(commandLogger, "info", "command.dispatched", {
    requestId: command.requestId,
    agentId: command.agentId,
    command: command.command,
    userId: command.operatorUserId,
    username: command.operatorUsername,
    authCodeId: command.authCodeId,
    authCodeFingerprint: command.authCodeFingerprint,
    webserverSignFingerprint: secureEnvelope.meta.webserverSignFingerprint,
    dispatchedAt
  });

  try {
    socket.send(JSON.stringify(secureEnvelope));
  } catch (error) {
    const failedRecord = commandStore.update(command.requestId, {
      status: "failed",
      secureStatus: "send_failed",
      securityError: error.message,
      error: error.message,
      completedAt: new Date().toISOString()
    });

    logEvent(commandLogger, "error", "command.socket_send_failed", {
      requestId: command.requestId,
      agentId: command.agentId,
      command: command.command,
      error: error.message
    });

    if (failedRecord) {
      browserHub.broadcast("command.updated", failedRecord);
    }

    return "failed";
  }

  return "dispatched";
}

function dispatchTerminalSessionCreate(sessionRecord, context) {
  const socket = agentRegistry.getSocket(sessionRecord.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: "Agent is offline."
    });
    return "failed";
  }

  let secureEnvelope;
  try {
    secureEnvelope = secureCommandService.createTerminalSessionCreateEnvelope({
      sessionRecord,
      operatorUser: context.user,
      authCodeBinding: context.authCodeBinding,
      launchPayload: context.launchPayload
    });
  } catch (error) {
    terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: error.message
    });
    logEvent(commandLogger, "error", "terminal.session.secure_dispatch_failed", {
      sessionId: sessionRecord.sessionId,
      agentId: sessionRecord.agentId,
      profile: sessionRecord.profile,
      error: error.message
    });
    return "failed";
  }

  terminalSessionStore.update(sessionRecord.sessionId, {
    status: "dispatched"
  });

  try {
    socket.send(JSON.stringify(secureEnvelope));
  } catch (error) {
    terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: error.message
    });
    return "failed";
  }

  return "dispatched";
}

function dispatchTerminalSessionInput(sessionRecord, context) {
  const socket = agentRegistry.getSocket(sessionRecord.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent is offline.");
  }

  const secureEnvelope = secureCommandService.createTerminalSessionInputEnvelope({
    requestId: randomUUID(),
    agentId: sessionRecord.agentId,
    sessionId: sessionRecord.sessionId,
    input: context.input,
    operatorUser: context.user,
    authCodeBinding: context.authCodeBinding
  });

  socket.send(JSON.stringify(secureEnvelope));
}

function dispatchTerminalSessionTerminate(sessionRecord, context) {
  const socket = agentRegistry.getSocket(sessionRecord.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent is offline.");
  }

  const secureEnvelope = secureCommandService.createTerminalSessionTerminateEnvelope({
    requestId: randomUUID(),
    agentId: sessionRecord.agentId,
    sessionId: sessionRecord.sessionId,
    operatorUser: context.user,
    authCodeBinding: context.authCodeBinding
  });

  socket.send(JSON.stringify(secureEnvelope));
}

async function dispatchTerminalSessionInputForUser({ user, sessionId, input }) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedInput = String(input || "");
  const session = terminalSessionStore.get(normalizedSessionId);

  if (!session) {
    throw createHttpError(404, "会话不存在");
  }

  if (!normalizedInput) {
    throw createHttpError(400, "input is required");
  }

  if (isTerminalSessionClosedStatus(session.status)) {
    throw createHttpError(409, "会话已关闭，不能继续输入");
  }

  const socket = agentRegistry.getSocket(session.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw createHttpError(409, "目标 agent 当前不在线");
  }

  const authCodeBinding = await authCodeService.findByUserIdAndAgentId(user.id, session.agentId);

  if (!authCodeBinding) {
    throw createHttpError(400, "当前用户未为该设备配置 auth_code");
  }

  dispatchTerminalSessionInput(session, {
    user,
    authCodeBinding,
    input: normalizedInput
  });

  return session;
}

async function handleBrowserMessage(socket, raw) {
  let message;

  try {
    message = JSON.parse(String(raw));
  } catch (error) {
    logEvent(serverLogger, "warn", "browser.websocket_invalid_message", {
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      error: error.message
    });
    return;
  }

  if (message.type === "terminal.session.input") {
    await handleBrowserTerminalSessionInput(socket, message.payload || {});
    return;
  }

  logEvent(serverLogger, "warn", "browser.websocket_unsupported_message", {
    userId: socket.auth.user.id,
    username: socket.auth.user.username,
    type: String(message.type || "")
  });
}

async function handleBrowserTerminalSessionInput(socket, payload) {
  const inputId = String(payload?.inputId || "").trim();
  const sessionId = String(payload?.sessionId || "").trim();
  const input = String(payload?.input || "");

  if (!inputId || !sessionId || !input) {
    sendTerminalSessionInputAck(socket, {
      inputId,
      sessionId,
      status: "rejected",
      error: "sessionId、inputId 和 input 不能为空"
    });
    return;
  }

  const receipt = terminalSessionStore.getInputReceipt(sessionId, inputId);

  if (receipt) {
    sendTerminalSessionInputAck(socket, {
      ...receipt,
      status: "duplicate",
      duplicate: true
    });
    return;
  }

  try {
    const session = await dispatchTerminalSessionInputForUser({
      user: socket.auth.user,
      sessionId,
      input
    });
    const acceptedAt = new Date().toISOString();
    const acceptedReceipt = terminalSessionStore.rememberInputReceipt(sessionId, inputId, {
      inputId,
      sessionId,
      agentId: session.agentId,
      status: "accepted",
      duplicate: false,
      acceptedAt,
      error: ""
    });

    sendTerminalSessionInputAck(socket, acceptedReceipt);
  } catch (error) {
    sendTerminalSessionInputAck(socket, {
      inputId,
      sessionId,
      status: "rejected",
      error: error.message || "会话输入下发失败"
    });
  }
}

function sendTerminalSessionInputAck(socket, payload) {
  browserHub.send(socket, "terminal.session.input.ack", {
    inputId: String(payload?.inputId || ""),
    sessionId: String(payload?.sessionId || ""),
    agentId: String(payload?.agentId || ""),
    status: String(payload?.status || "rejected"),
    duplicate: Boolean(payload?.duplicate),
    acceptedAt: payload?.acceptedAt || null,
    error: String(payload?.error || "")
  });
}

function loadCommandDispatchContext(command) {
  return command[commandDispatchContextSymbol] || null;
}

function storeCommandDispatchContext(command, context) {
  Object.defineProperty(command, commandDispatchContextSymbol, {
    value: context,
    writable: true,
    configurable: true,
    enumerable: false
  });
}

function inferSecureStatusFromResult(payload) {
  if (payload.securityError) {
    return "rejected";
  }

  if (payload.status === "completed") {
    return "verified";
  }

  return payload.secureStatus || "verified";
}

function authorizeAgentRequest(url) {
  if (!config.agentSharedToken) {
    return true;
  }

  return url.searchParams.get("token") === config.agentSharedToken;
}

async function requireAuth(req, res, next) {
  const auth = await resolveRequestAuth(req);

  if (!auth) {
    logEvent(serverLogger, "warn", "auth.unauthorized", {
      path: req.path,
      ...getRequestContext(req)
    });
    clearSessionCookie(res);
    res.status(401).json({ message: "请先登录" });
    return;
  }

  req.auth = auth;
  setSessionCookie(res, auth.sessionToken, auth.expiresAt);
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.auth.user.role !== "admin") {
      res.status(403).json({ message: "需要管理员权限" });
      return;
    }

    next();
  });
}

async function resolveRequestAuth(req) {
  const sessionToken = getSessionTokenFromRequest(req);

  if (!sessionToken) {
    return null;
  }

  try {
    const session = await sessionService.getSessionByToken(sessionToken);

    if (!session) {
      return null;
    }

    const expiresAt = await sessionService.touchSession(session.id);

    return {
      sessionId: session.id,
      sessionToken,
      expiresAt,
      user: {
        id: session.user_id,
        username: session.username,
        displayName: session.display_name,
        role: session.role,
        isActive: Boolean(session.is_active)
      }
    };
  } catch (error) {
    logEvent(serverLogger, "error", "auth.session_lookup_failed", {
      error: error.message
    });
    return null;
  }
}

function getSessionTokenFromRequest(req) {
  const cookies = cookie.parse(req.headers?.cookie || "");
  return cookies[config.sessionCookieName] || "";
}

function setSessionCookie(res, sessionToken, expiresAt) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(config.sessionCookieName, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.sessionSecure,
      path: "/",
      expires: new Date(expiresAt)
    })
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(config.sessionCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.sessionSecure,
      path: "/",
      expires: new Date(0)
    })
  );
}

function getRequestContext(req) {
  return {
    ipAddress: req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "",
    userAgent: req.headers?.["user-agent"] || ""
  };
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUserPayload(body) {
  return {
    username: normalizeUsername(body?.username),
    displayName: String(body?.displayName || "").trim()
  };
}

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  return ["admin", "operator", "viewer"].includes(value) ? value : "";
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function isDuplicateEntryError(error) {
  return error?.code === "ER_DUP_ENTRY";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isTerminalSessionClosedStatus(status) {
  return ["completed", "failed", "terminated", "connection_lost"].includes(String(status || ""));
}

async function ensureUserAuthCodesTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_auth_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      agent_id VARCHAR(128) NOT NULL,
      auth_code LONGTEXT NOT NULL,
      remark VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_user_auth_codes_user_agent (user_id, agent_id),
      KEY idx_user_auth_codes_user_id (user_id),
      CONSTRAINT fk_user_auth_codes_user_id
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function formatUnknownError(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      stack: reason.stack || ""
    };
  }

  return String(reason);
}
