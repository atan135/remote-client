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
import {
  CommandHistoryService,
  createCommandOutputPreview,
  summarizeCommandRecord
} from "./persistence/command-history-service.js";
import {
  TerminalSessionHistoryService,
  summarizeTerminalSessionRecord
} from "./persistence/terminal-session-history-service.js";
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
const commandHistoryService = new CommandHistoryService(pool);
const terminalSessionHistoryService = new TerminalSessionHistoryService(pool);
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
const pendingAgentDisconnects = new Map();
const pendingRemoteFileReads = new Map();
const pendingTerminalSessionPersists = new Map();
const pendingTerminalSessionTurnSyncs = new Map();
const agentHeartbeatBroadcastState = new Map();
const remoteFileReadTimeoutMs = Math.max(5000, Math.min(config.secureCommandTtlMs, 20000));
const terminalSessionPersistDebounceMs = Math.max(0, config.terminalSessionPersistDebounceMs);
const terminalSessionTurnSyncDebounceMs = Math.max(0, config.terminalSessionTurnSyncDebounceMs);
const agentHeartbeatBroadcastIntervalMs = Math.max(0, config.agentHeartbeatBroadcastIntervalMs);

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
  void handleCommandHistoryRequest(req, res);
});

app.post("/api/commands", requireAuth, (req, res) => {
  void handleCommandRequest(req, res);
});

app.get("/api/terminal-sessions", requireAuth, (req, res) => {
  void handleTerminalSessionHistoryRequest(req, res);
});

app.get("/api/terminal-sessions/:sessionId", requireAuth, (req, res) => {
  const session = terminalSessionStore.get(String(req.params.sessionId || ""));

  if (!session) {
    res.status(404).json({ message: "会话不存在" });
    return;
  }

  res.json({ item: serializeTerminalSession(session) });
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

app.delete("/api/terminal-sessions/:sessionId", requireAuth, (req, res) => {
  void handleTerminalSessionDeleteRequest(req, res);
});

app.post("/api/remote-files/read", requireAuth, (req, res) => {
  void handleRemoteFileReadRequest(req, res);
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
    void persistCommandRecord(record);
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

    browserHub.broadcast("command.updated", serializeCommandRecord(record));

    if (dispatchResult === "failed") {
      res.status(500).json({
        message: record.error || "命令安全封装失败",
        item: serializeCommandRecord(record),
        queued: false
      });
      return;
    }

    res.status(dispatchResult === "dispatched" ? 202 : 201).json({
      item: serializeCommandRecord(record),
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
    cols: normalizeTerminalDimension(req.body?.cols) || 120,
    rows: normalizeTerminalDimension(req.body?.rows) || 30
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
    const agent = agentRegistry.get(agentId);
    const profileConfig =
      agent?.terminalProfiles?.find((item) => item.name === profile) || null;
    const profileLabel = String(profileConfig?.label || profile || "").trim();

    if (!authCodeBinding) {
      res.status(400).json({ message: "当前用户未为该设备配置 auth_code" });
      return;
    }

    if (Array.isArray(agent?.terminalProfiles) && agent.terminalProfiles.length > 0 && !profileConfig) {
      res.status(400).json({ message: `目标 agent 不支持终端 profile: ${profile}` });
      return;
    }

    if (profileConfig?.isAvailable === false) {
      res.status(400).json({
        message:
          profileConfig.unavailableReason ||
          `终端 profile 当前不可用: ${profile}`
      });
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
        profileLabel,
        profileSource: String(profileConfig?.source || ""),
        profileKind: String(profileConfig?.kind || ""),
        cwd: launchPayload.cwd,
        envKeys: Object.keys(launchPayload.env),
        displayMode: normalizeProfileOutputMode(profileConfig?.outputMode),
        finalOutputMarkers: normalizeFinalOutputMarkers(profileConfig?.finalOutputMarkers),
        cols: launchPayload.cols,
        rows: launchPayload.rows
      }
    });
    void persistTerminalSessionRecord(record);
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

    broadcastTerminalSessionUpdate(record);

    if (dispatchResult === "failed") {
      res.status(500).json({
        message: record.error || "终端会话下发失败",
        item: serializeTerminalSession(record)
      });
      return;
    }

    res.status(202).json({ item: serializeTerminalSession(record) });
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
  const now = new Date().toISOString();
  const session = terminalSessionStore.get(sessionId);

  if (!session) {
    try {
      const storedSession = await terminalSessionHistoryService.getBySessionId(sessionId);

      if (!storedSession) {
        res.status(404).json({ message: "会话不存在" });
        return;
      }

      if (isTerminalSessionClosedStatus(storedSession.status)) {
        res.json({
          ok: true,
          alreadyClosed: true,
          sessionId,
          item: storedSession
        });
        return;
      }

      const reconciledSession = await terminalSessionHistoryService.updateSession(sessionId, {
        status: "terminated",
        error: storedSession.error || "终端会话已不在活动列表中，按已结束处理。",
        updatedAt: now,
        closedAt: storedSession.closedAt || now
      });

      const item =
        reconciledSession || {
          ...storedSession,
          status: "terminated",
          error: storedSession.error || "终端会话已不在活动列表中，按已结束处理。",
          updatedAt: now,
          closedAt: storedSession.closedAt || now
        };
      broadcastTerminalSessionUpdate(item);
      res.json({
        ok: true,
        reconciled: true,
        sessionId,
        item
      });
    } catch (error) {
      logEvent(commandLogger, "error", "terminal.session.terminate_reconcile_failed", {
        sessionId,
        userId: req.auth.user.id,
        username: req.auth.user.username,
        error: error.message
      });
      res.status(500).json({ message: error.message || "终端会话终止失败" });
    }
    return;
  }

  if (isTerminalSessionClosedStatus(session.status)) {
    res.json({
      ok: true,
      alreadyClosed: true,
      sessionId,
      item: serializeTerminalSession(session)
    });
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
    const updatedSession = terminalSessionStore.update(sessionId, {
      status: "terminating"
    });
    void persistTerminalSessionRecord(updatedSession || session);
    broadcastTerminalSessionUpdate(terminalSessionStore.get(sessionId));

    res.status(202).json({
      ok: true,
      sessionId,
      item: serializeTerminalSession(updatedSession || session)
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "会话终止下发失败" });
  }
}

async function handleTerminalSessionDeleteRequest(req, res) {
  const sessionId = String(req.params.sessionId || "").trim();
  const activeSession = terminalSessionStore.get(sessionId);
  const storedSession = activeSession
    ? null
    : await terminalSessionHistoryService.getBySessionId(sessionId);
  const session = activeSession || storedSession;

  if (!session) {
    res.status(404).json({ message: "会话不存在" });
    return;
  }

  if (!isTerminalSessionClosedStatus(session.status)) {
    res.status(409).json({ message: "仅允许删除已结束的终端会话" });
    return;
  }

  try {
    await flushTerminalSessionPersistence(sessionId);
    const removedActiveSession = terminalSessionStore.remove(sessionId);
    const deletedFromHistory = await terminalSessionHistoryService.deleteSession(sessionId);
    clearPendingTerminalSessionPersist(sessionId);
    clearPendingTerminalSessionTurnSync(sessionId);
    const payload = {
      sessionId,
      agentId: String(session.agentId || removedActiveSession?.agentId || ""),
      deletedAt: new Date().toISOString()
    };

    logEvent(commandLogger, "info", "terminal.session.deleted", {
      sessionId,
      agentId: payload.agentId,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      deletedFromHistory,
      removedActiveSession: Boolean(removedActiveSession)
    });

    browserHub.broadcast("terminal.session.deleted", payload);
    res.json({
      ok: true,
      sessionId,
      deletedFromHistory,
      removedActiveSession: Boolean(removedActiveSession)
    });
  } catch (error) {
    logEvent(commandLogger, "error", "terminal.session.delete_failed", {
      sessionId,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message
    });
    res.status(500).json({ message: error.message || "终端会话删除失败" });
  }
}

async function handleRemoteFileReadRequest(req, res) {
  const agentId = String(req.body?.agentId || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  const filePath = normalizeRemoteFilePath(req.body?.filePath);

  if (!agentId || !filePath) {
    res.status(400).json({ message: "agentId and filePath are required" });
    return;
  }

  try {
    const item = await dispatchRemoteFileReadForUser({
      user: req.auth.user,
      agentId,
      sessionId,
      filePath
    });

    res.json({ item });
  } catch (error) {
    logEvent(commandLogger, "warn", "file.read.request_failed", {
      agentId,
      sessionId,
      filePath,
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message
    });
    res.status(error.statusCode || 500).json({ message: error.message || "远程读取文件失败" });
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
      void handleAgentMessage(agentId, socket, message).catch((error) => {
        logEvent(serverLogger, "error", "agent.message_handle_failed", {
          agentId,
          type: String(message?.type || ""),
          error: error.message,
          stack: error.stack || ""
        });
      });
    } catch (error) {
      logEvent(serverLogger, "error", "agent.invalid_message", {
        agentId,
        error: error.message,
        raw: String(raw)
      });
    }
  });

  socket.on("error", (error) => {
    logEvent(serverLogger, "error", "agent.websocket_error", {
      agentId,
      error: error.message
    });
  });

  socket.on("close", (code, reasonBuffer) => {
    const agent = agentRegistry.disconnect(agentId);
    const reason = normalizeSocketCloseReason(reasonBuffer);
    scheduleAgentDisconnectHandling(agentId, {
      closeCode: code,
      closeReason: reason
    });

    logEvent(serverLogger, "warn", "agent.websocket_disconnected", {
      agentId,
      closeCode: code,
      closeReason: reason,
      disconnectGraceMs: config.agentDisconnectGraceMs
    });

    if (agent) {
      clearAgentBroadcastState(agent.agentId);
      browserHub.broadcast("agent.updated", agent);
      rememberAgentBroadcast(agent, "disconnect");
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
  void sendBrowserSnapshot(socket);

  socket.on("message", (raw) => {
    void handleBrowserMessage(socket, raw);
  });

  socket.on("error", (error) => {
    browserHub.remove(socket);
    logEvent(serverLogger, "warn", "browser.websocket_error", {
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      error: error.message,
      subscribers: browserHub.sockets.size
    });
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
    await commandHistoryService.ensureTables();
    await terminalSessionHistoryService.ensureTables();
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

function scheduleAgentDisconnectHandling(agentId, meta = {}) {
  clearPendingAgentDisconnect(agentId);

  const timer = setTimeout(() => {
    pendingAgentDisconnects.delete(agentId);

    const socket = agentRegistry.getSocket(agentId);

    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    const changedCommands = commandStore.markAgentDisconnected(agentId);
    const changedSessions = terminalSessionStore.markAgentDisconnected(agentId);
    rejectPendingRemoteFileReadsByAgent(agentId, "目标 agent 已断开连接，文件读取未完成");

    logEvent(serverLogger, "warn", "agent.disconnect_grace_expired", {
      agentId,
      closeCode: meta.closeCode ?? null,
      closeReason: meta.closeReason || "",
      affectedCommands: changedCommands.length,
      affectedSessions: changedSessions.length
    });

    for (const command of changedCommands) {
      void persistCommandRecord(command);
      browserHub.broadcast("command.updated", serializeCommandRecord(command));
    }

    for (const session of changedSessions) {
      void persistTerminalSessionRecord(session);
      broadcastTerminalSessionUpdate(session);
    }
  }, config.agentDisconnectGraceMs);

  pendingAgentDisconnects.set(agentId, {
    timer,
    disconnectedAt: new Date().toISOString(),
    ...meta
  });
}

function clearPendingAgentDisconnect(agentId) {
  const pending = pendingAgentDisconnects.get(agentId) || null;

  if (pending?.timer) {
    clearTimeout(pending.timer);
  }

  pendingAgentDisconnects.delete(agentId);
  return pending;
}

function createPendingRemoteFileRead({ requestId, agentId, filePath, user }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRemoteFileReads.delete(requestId);
      logEvent(commandLogger, "warn", "file.read.timeout", {
        requestId,
        agentId,
        filePath,
        userId: user.id,
        username: user.username,
        timeoutMs: remoteFileReadTimeoutMs
      });
      reject(createHttpError(504, "远程读取文件超时"));
    }, remoteFileReadTimeoutMs);

    pendingRemoteFileReads.set(requestId, {
      requestId,
      agentId,
      filePath,
      userId: user.id,
      username: user.username,
      timer,
      resolve,
      reject
    });
  });
}

function cancelPendingRemoteFileRead(requestId) {
  const pending = pendingRemoteFileReads.get(String(requestId || "").trim());

  if (!pending) {
    return null;
  }

  if (pending.timer) {
    clearTimeout(pending.timer);
  }

  pendingRemoteFileReads.delete(pending.requestId);
  return pending;
}

function resolveRemoteFileReadRequest(payload) {
  const requestId = String(payload?.requestId || "").trim();
  const pending = cancelPendingRemoteFileRead(requestId);

  if (!pending) {
    return;
  }

  const item = {
    requestId,
    agentId: String(payload?.agentId || pending.agentId || ""),
    filePath: String(payload?.filePath || pending.filePath || ""),
    resolvedPath: String(payload?.resolvedPath || payload?.filePath || ""),
    content: String(payload?.content || ""),
    truncated: Boolean(payload?.truncated),
    bytesRead: Number(payload?.bytesRead || 0),
    totalBytes: Number(payload?.totalBytes || 0),
    encoding: String(payload?.encoding || "utf8"),
    modifiedAt: payload?.modifiedAt || null,
    readAt: payload?.readAt || new Date().toISOString()
  };

  logEvent(commandLogger, "info", "file.read.completed", {
    requestId,
    agentId: item.agentId,
    filePath: item.filePath,
    resolvedPath: item.resolvedPath,
    truncated: item.truncated,
    bytesRead: item.bytesRead,
    totalBytes: item.totalBytes,
    encoding: item.encoding,
    userId: pending.userId,
    username: pending.username
  });

  pending.resolve(item);
}

function rejectRemoteFileReadRequest(payload) {
  const requestId = String(payload?.requestId || "").trim();
  const pending = cancelPendingRemoteFileRead(requestId);

  if (!pending) {
    return;
  }

  const errorMessage = String(payload?.error || "远程读取文件失败");
  const errorCode = String(payload?.errorCode || "");

  logEvent(commandLogger, "warn", "file.read.failed", {
    requestId,
    agentId: String(payload?.agentId || pending.agentId || ""),
    filePath: String(payload?.filePath || pending.filePath || ""),
    errorCode,
    error: errorMessage,
    userId: pending.userId,
    username: pending.username
  });

  pending.reject(createHttpError(mapRemoteFileReadErrorCode(errorCode), errorMessage));
}

function rejectPendingRemoteFileReadsByAgent(agentId, errorMessage) {
  const normalizedAgentId = String(agentId || "").trim();

  if (!normalizedAgentId) {
    return;
  }

  for (const [requestId, pending] of pendingRemoteFileReads.entries()) {
    if (pending.agentId !== normalizedAgentId) {
      continue;
    }

    cancelPendingRemoteFileRead(requestId);
    pending.reject(createHttpError(409, errorMessage));
  }
}

function mapRemoteFileReadErrorCode(errorCode) {
  const normalized = String(errorCode || "").trim().toUpperCase();

  if (normalized === "ENOENT") {
    return 404;
  }

  if (normalized === "EACCES" || normalized === "EPERM") {
    return 403;
  }

  return 400;
}

function reconcileMissingAgentTerminalSessions(agentId, syncedTerminalSessions) {
  const activeSessionIds = new Set(
    (Array.isArray(syncedTerminalSessions) ? syncedTerminalSessions : [])
      .map((session) => String(session?.sessionId || ""))
      .filter(Boolean)
  );

  return terminalSessionStore
    .list(config.terminalSessionHistoryLimit)
    .filter(Boolean)
    .filter((session) => session.agentId === agentId)
    .filter((session) => ["created", "dispatched", "running", "terminating"].includes(session.status))
    .filter((session) => !activeSessionIds.has(session.sessionId))
    .map((session) =>
      terminalSessionStore.update(session.sessionId, {
        status: "connection_lost",
        error: "Agent reconnected, but the terminal session was not found on the agent. It likely ended during disconnect or localapp restart."
      })
    )
    .filter(Boolean);
}

function normalizeSocketCloseReason(reasonBuffer) {
  const reason = Buffer.isBuffer(reasonBuffer)
    ? reasonBuffer.toString("utf8")
    : String(reasonBuffer || "");

  return reason.trim();
}

async function handleAgentMessage(agentId, socket, message) {
  if (message.type === "agent.register") {
    const agent = agentRegistry.register(message.payload, socket);
    const pendingDisconnect = clearPendingAgentDisconnect(agent.agentId);
    const syncedTerminalSessions = await syncAgentTerminalSessions(
      agent.agentId,
      message.payload.activeTerminalSessions
    );
    const missingTerminalSessions = pendingDisconnect
      ? reconcileMissingAgentTerminalSessions(agent.agentId, syncedTerminalSessions)
      : [];
    logEvent(serverLogger, "info", "agent.registered", {
      agentId: agent.agentId,
      label: agent.label,
      hostname: agent.hostname,
      platform: agent.platform,
      arch: agent.arch,
      presetCommandCount: Array.isArray(agent.presetCommands) ? agent.presetCommands.length : 0,
      commonWorkingDirectoryCount: agent.commonWorkingDirectories.length,
      activeTerminalSessionCount: syncedTerminalSessions.length,
      recoveredTerminalSessionCount: pendingDisconnect ? syncedTerminalSessions.length : 0,
      missingTerminalSessionCount: missingTerminalSessions.length,
      reconnectedWithinGrace: Boolean(pendingDisconnect)
    });
    browserHub.broadcast("agent.updated", agent);
    rememberAgentBroadcast(agent, "register");
    for (const session of syncedTerminalSessions) {
      broadcastTerminalSessionUpdate(session);
      void persistTerminalSessionRecord(session);
    }
    for (const session of missingTerminalSessions) {
      broadcastTerminalSessionUpdate(session);
      void persistTerminalSessionRecord(session);
    }
    dispatchQueuedCommands(agent.agentId);
    return;
  }

  if (message.type === "agent.heartbeat") {
    const agent = agentRegistry.heartbeat(agentId);

    if (agent && shouldBroadcastHeartbeat(agent.agentId)) {
      browserHub.broadcast("agent.updated", agent);
      rememberAgentBroadcast(agent, "heartbeat");
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
      void persistCommandRecord(record);
      logEvent(commandLogger, "info", "command.started", {
        requestId: record.requestId,
        agentId: record.agentId,
        command: record.command,
        startedAt: record.startedAt
      });
      browserHub.broadcast("command.updated", serializeCommandRecord(record));
    }

    return;
  }

  if (message.type === "command.finished") {
    const stdout = String(message.payload.stdout || "");
    const stderr = String(message.payload.stderr || "");
    const record = commandStore.update(message.payload.requestId, {
      status: message.payload.status,
      secureStatus: message.payload.secureStatus || inferSecureStatusFromResult(message.payload),
      exitCode: message.payload.exitCode,
      stdout: createCommandOutputPreview(stdout),
      stderr: createCommandOutputPreview(stderr),
      stdoutChars: stdout.length,
      stderrChars: stderr.length,
      error: message.payload.error || "",
      securityError: message.payload.securityError || "",
      startedAt: message.payload.startedAt || null,
      completedAt: message.payload.completedAt || new Date().toISOString()
    });

    if (record) {
      const summary = summarizeCommandRecord(record);
      void persistCommandRecord(record);
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
          stdoutChars: summary.stdoutChars,
          stderrChars: summary.stderrChars,
          stdoutPreview: summary.stdoutPreview,
          stderrPreview: summary.stderrPreview,
          error: summary.error,
          secureStatus: record.secureStatus,
          securityError: record.securityError,
          startedAt: record.startedAt,
          completedAt: record.completedAt
        }
      );
      browserHub.broadcast("command.updated", serializeCommandRecord(record));
    }

    return;
  }

  if (message.type === "file.read.completed") {
    resolveRemoteFileReadRequest(message.payload);
    return;
  }

  if (message.type === "file.read.error") {
    rejectRemoteFileReadRequest(message.payload);
    return;
  }

  if (message.type === "terminal.session.created") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      status: "running",
      startedAt: message.payload.startedAt || new Date().toISOString(),
      pid: message.payload.pid ?? null,
      profileLabel: String(message.payload.profileLabel || ""),
      profileSource: String(message.payload.profileSource || ""),
      profileKind: String(message.payload.profileKind || ""),
      error: ""
    });

    if (record) {
      void persistTerminalSessionRecord(record);
      broadcastTerminalSessionUpdate(record);
    }

    return;
  }

  if (message.type === "terminal.session.resized") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      cols: normalizeTerminalDimension(message.payload.cols) || null,
      rows: normalizeTerminalDimension(message.payload.rows) || null
    });

    if (record) {
      void persistTerminalSessionRecord(record);
      broadcastTerminalSessionUpdate(record);
    }

    return;
  }

  if (message.type === "terminal.session.output") {
    const result = terminalSessionStore.appendOutput(message.payload.sessionId, message.payload);

    if (result) {
      const finalPatch = deriveTerminalSessionDisplayPatch(result.record);
      let updatedRecord = result.record;
      const reconnectPatch =
        result.record.status === "connection_lost"
          ? {
              status: "running",
              error: ""
            }
          : null;

      if (reconnectPatch) {
        updatedRecord = terminalSessionStore.update(result.record.sessionId, reconnectPatch) || updatedRecord;
      }

      if (finalPatch) {
        updatedRecord =
          terminalSessionStore.update(result.record.sessionId, finalPatch) || result.record;
      }

      void persistTerminalSessionRecord(updatedRecord);
      void maybeSyncTerminalSessionTurn(updatedRecord, { allowEmpty: false });
      logEvent(commandLogger, "info", "terminal.session.output_forwarded", {
        sessionId: result.record.sessionId,
        requestId: result.record.requestId,
        agentId: result.record.agentId,
        profile: result.record.profile,
        seq: result.output.seq,
        chunkLength: String(result.output.chunk || "").length,
        outputsInMemory: Array.isArray(updatedRecord.outputs) ? updatedRecord.outputs.length : 0,
        lastOutputAt: updatedRecord.lastOutputAt || result.output.sentAt,
        browserSubscribers: browserHub.sockets.size
      });
      browserHub.broadcast("terminal.session.output", result.output);

      if (reconnectPatch || finalPatch) {
        broadcastTerminalSessionUpdate(
          terminalSessionStore.get(result.record.sessionId) || updatedRecord
        );
      }
    }

    if (!result) {
      logEvent(commandLogger, "warn", "terminal.session.output_dropped", {
        sessionId: String(message.payload?.sessionId || ""),
        agentId,
        seq: Number(message.payload?.seq || 0),
        chunkLength: String(message.payload?.chunk || "").length
      });
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
      void persistTerminalSessionRecord(record);
      void maybeSyncTerminalSessionTurn(record, { allowEmpty: true });
      broadcastTerminalSessionUpdate(record);
    }

    return;
  }

  if (message.type === "terminal.session.error") {
    const record = terminalSessionStore.update(message.payload.sessionId, {
      status: "failed",
      error: message.payload.error || "terminal session failed"
    });

    if (record) {
      void persistTerminalSessionRecord(record);
      void maybeSyncTerminalSessionTurn(record, { allowEmpty: true });
      broadcastTerminalSessionUpdate(record);
      logEvent(commandLogger, "warn", "terminal.session.failed", {
        sessionId: record.sessionId,
        requestId: record.requestId,
        agentId: record.agentId,
        profile: record.profile,
        error: record.error
      });
    }
  }
}

async function syncAgentTerminalSessions(agentId, sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  const synced = [];
  const agent = agentRegistry.get(agentId);
  const terminalProfiles = Array.isArray(agent?.terminalProfiles) ? agent.terminalProfiles : [];

  for (const sessionLike of sessions) {
    if (String(sessionLike?.agentId || agentId) !== agentId) {
      continue;
    }

    const sessionId = String(sessionLike?.sessionId || "");
    const existing =
      terminalSessionStore.get(sessionId) ||
      (await terminalSessionHistoryService.getBySessionId(sessionId));
    const profile = String(sessionLike?.profile || existing?.profile || "");
    const profileConfig = terminalProfiles.find((item) => item.name === profile) || null;
    const profileLabel =
      String(sessionLike?.profileLabel || existing?.profileLabel || profileConfig?.label || profile).trim();
    const nextStatus = resolveResyncedTerminalSessionStatus(sessionLike?.status);
    const syncedRecord = terminalSessionStore.upsert({
      ...(existing || {}),
      ...sessionLike,
      sessionId,
      agentId,
      profile,
      profileLabel,
      profileSource: String(sessionLike?.profileSource || existing?.profileSource || profileConfig?.source || ""),
      profileKind: String(sessionLike?.profileKind || existing?.profileKind || profileConfig?.kind || ""),
      displayMode: normalizeProfileOutputMode(
        sessionLike?.displayMode || existing?.displayMode || profileConfig?.outputMode
      ),
      finalOutputMarkers:
        normalizeFinalOutputMarkers(sessionLike?.finalOutputMarkers) ||
        existing?.finalOutputMarkers ||
        normalizeFinalOutputMarkers(profileConfig?.finalOutputMarkers),
      status: nextStatus,
      error: nextStatus === "running" ? "" : String(sessionLike?.error || existing?.error || "")
    });

    if (!syncedRecord) {
      continue;
    }

    logEvent(commandLogger, "info", "terminal.session.resynced", {
      sessionId: syncedRecord.sessionId,
      requestId: syncedRecord.requestId,
      agentId: syncedRecord.agentId,
      status: syncedRecord.status,
      outputsInMemory: Array.isArray(syncedRecord.outputs) ? syncedRecord.outputs.length : 0,
      lastOutputAt: syncedRecord.lastOutputAt || ""
    });

    synced.push(syncedRecord);
  }

  return synced;
}

function resolveResyncedTerminalSessionStatus(status) {
  const normalized = String(status || "");

  if (normalized === "terminating") {
    return "terminating";
  }

  return isTerminalSessionClosedStatus(normalized) ? "terminated" : "running";
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
      void persistCommandRecord(failedRecord);
      browserHub.broadcast("command.updated", serializeCommandRecord(failedRecord));
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
      void persistCommandRecord(failedRecord);
      browserHub.broadcast("command.updated", serializeCommandRecord(failedRecord));
    }

    return false;
  }

  const dispatchedAt = secureEnvelope.sentAt;

  const dispatchedRecord = commandStore.update(command.requestId, {
    status: "dispatched",
    secureStatus: "encrypted",
    securityError: "",
    dispatchedAt,
    error: "",
    expiresAt: secureEnvelope.meta.expiresAt,
    webserverSignFingerprint: secureEnvelope.meta.webserverSignFingerprint
  });
  void persistCommandRecord(dispatchedRecord || command);

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
      void persistCommandRecord(failedRecord);
      browserHub.broadcast("command.updated", serializeCommandRecord(failedRecord));
    }

    return "failed";
  }

  return "dispatched";
}

function dispatchTerminalSessionCreate(sessionRecord, context) {
  const socket = agentRegistry.getSocket(sessionRecord.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    const failedRecord = terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: "Agent is offline."
    });
    void persistTerminalSessionRecord(failedRecord || sessionRecord);
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
    const failedRecord = terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: error.message
    });
    void persistTerminalSessionRecord(failedRecord || sessionRecord);
    logEvent(commandLogger, "error", "terminal.session.secure_dispatch_failed", {
      sessionId: sessionRecord.sessionId,
      agentId: sessionRecord.agentId,
      profile: sessionRecord.profile,
      error: error.message
    });
    return "failed";
  }

  const dispatchedRecord = terminalSessionStore.update(sessionRecord.sessionId, {
    status: "dispatched"
  });
  void persistTerminalSessionRecord(dispatchedRecord || sessionRecord);

  try {
    socket.send(JSON.stringify(secureEnvelope));
  } catch (error) {
    const failedRecord = terminalSessionStore.update(sessionRecord.sessionId, {
      status: "failed",
      error: error.message
    });
    void persistTerminalSessionRecord(failedRecord || sessionRecord);
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

function dispatchTerminalSessionResize(sessionRecord, context) {
  const socket = agentRegistry.getSocket(sessionRecord.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent is offline.");
  }

  const secureEnvelope = secureCommandService.createTerminalSessionResizeEnvelope({
    requestId: randomUUID(),
    agentId: sessionRecord.agentId,
    sessionId: sessionRecord.sessionId,
    cols: context.cols,
    rows: context.rows,
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

function dispatchRemoteFileRead(agentId, context) {
  const socket = agentRegistry.getSocket(agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw createHttpError(409, "目标 agent 当前不在线");
  }

  const requestId = randomUUID();
  const secureEnvelope = secureCommandService.createFileReadEnvelope({
    requestId,
    agentId,
    sessionId: context.sessionId,
    filePath: context.filePath,
    operatorUser: context.user,
    authCodeBinding: context.authCodeBinding
  });
  const pendingPromise = createPendingRemoteFileRead({
    requestId,
    agentId,
    filePath: context.filePath,
    user: context.user
  });

  try {
    socket.send(JSON.stringify(secureEnvelope));
  } catch (error) {
    cancelPendingRemoteFileRead(requestId);
    throw error;
  }

  return pendingPromise;
}

async function dispatchTerminalSessionInputForUser({ user, sessionId, input, logicalInput = "" }) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedInput = String(input || "");
  let session = terminalSessionStore.get(normalizedSessionId);

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

  if (["final_only", "hybrid"].includes(String(session.displayMode || ""))) {
    session =
      terminalSessionStore.update(normalizedSessionId, {
        finalText: "",
        finalTextUpdatedAt: null
      }) || session;
    void persistTerminalSessionRecord(session);
    broadcastTerminalSessionUpdate(session);
  }

  dispatchTerminalSessionInput(session, {
    user,
    authCodeBinding,
    input: normalizedInput
  });
  void maybeRecordTerminalSessionTurn(session, logicalInput, normalizedInput);

  return session;
}

async function dispatchTerminalSessionResizeForUser({ user, sessionId, cols, rows }) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedCols = normalizeTerminalDimension(cols);
  const normalizedRows = normalizeTerminalDimension(rows);
  const session = terminalSessionStore.get(normalizedSessionId);

  if (!session) {
    throw createHttpError(404, "会话不存在");
  }

  if (!normalizedCols || !normalizedRows) {
    throw createHttpError(400, "cols and rows are required");
  }

  if (isTerminalSessionClosedStatus(session.status)) {
    throw createHttpError(409, "会话已关闭，不能继续调整尺寸");
  }

  const socket = agentRegistry.getSocket(session.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw createHttpError(409, "目标 agent 当前不在线");
  }

  const authCodeBinding = await authCodeService.findByUserIdAndAgentId(user.id, session.agentId);

  if (!authCodeBinding) {
    throw createHttpError(400, "当前用户未为该设备配置 auth_code");
  }

  dispatchTerminalSessionResize(session, {
    user,
    authCodeBinding,
    cols: normalizedCols,
    rows: normalizedRows
  });

  return session;
}

async function dispatchRemoteFileReadForUser({ user, agentId, sessionId, filePath }) {
  const normalizedAgentId = String(agentId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedFilePath = normalizeRemoteFilePath(filePath);

  if (!normalizedAgentId || !normalizedFilePath) {
    throw createHttpError(400, "agentId and filePath are required");
  }

  const socket = agentRegistry.getSocket(normalizedAgentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw createHttpError(409, "目标 agent 当前不在线");
  }

  const authCodeBinding = await authCodeService.findByUserIdAndAgentId(user.id, normalizedAgentId);

  if (!authCodeBinding) {
    throw createHttpError(400, "当前用户未为该设备配置 auth_code");
  }

  logEvent(commandLogger, "info", "file.read.requested", {
    agentId: normalizedAgentId,
    sessionId: normalizedSessionId,
    filePath: normalizedFilePath,
    userId: user.id,
    username: user.username
  });

  try {
    return await dispatchRemoteFileRead(normalizedAgentId, {
      user,
      authCodeBinding,
      sessionId: normalizedSessionId,
      filePath: normalizedFilePath
    });
  } catch (error) {
    throw createHttpError(error.statusCode || 500, error.message || "远程读取文件失败");
  }
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

  if (message.type === "terminal.session.resize") {
    await handleBrowserTerminalSessionResize(socket, message.payload || {});
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
  const logicalInput = String(payload?.logicalInput || "");

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
      input,
      logicalInput
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

async function handleBrowserTerminalSessionResize(socket, payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  const cols = normalizeTerminalDimension(payload?.cols);
  const rows = normalizeTerminalDimension(payload?.rows);

  if (!sessionId || !cols || !rows) {
    logEvent(commandLogger, "warn", "terminal.session.resize_invalid", {
      sessionId,
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      cols: payload?.cols ?? null,
      rows: payload?.rows ?? null
    });
    return;
  }

  try {
    await dispatchTerminalSessionResizeForUser({
      user: socket.auth.user,
      sessionId,
      cols,
      rows
    });
  } catch (error) {
    logEvent(commandLogger, "warn", "terminal.session.resize_rejected", {
      sessionId,
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      cols,
      rows,
      error: error.message
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

function normalizeRemoteFilePath(value) {
  const trimmed = String(value || "").trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeTerminalDimension(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isTerminalSessionClosedStatus(status) {
  return ["completed", "failed", "terminated", "connection_lost"].includes(String(status || ""));
}

function normalizeProfileOutputMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["terminal", "final_only", "hybrid"].includes(normalized) ? normalized : "terminal";
}

function normalizeFinalOutputMarkers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const start = String(value.start || "").trim();
  const end = String(value.end || "").trim();

  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function deriveTerminalSessionDisplayPatch(record) {
  if (!record) {
    return null;
  }

  const markers = normalizeFinalOutputMarkers(record.finalOutputMarkers);
  const needsFinalTextExtraction =
    Boolean(markers) ||
    record.displayMode === "final_only" ||
    record.displayMode === "hybrid";

  if (!needsFinalTextExtraction) {
    return null;
  }

  const transcript = String(record.rawTranscript || "");
  const nextFinalText = extractFinalText(record, transcript, markers);
  const patch = {};

  if (nextFinalText !== String(record.finalText || "")) {
    patch.finalText = nextFinalText;
    patch.finalTextUpdatedAt = new Date().toISOString();
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function extractFinalText(record, transcript, markers = normalizeFinalOutputMarkers(record?.finalOutputMarkers)) {
  if (markers) {
    const marked = extractTextBetweenMarkers(transcript, markers.start, markers.end);

    if (marked) {
      return marked;
    }

    return "";
  }

  if (record?.displayMode === "final_only" || record?.displayMode === "hybrid") {
    return extractLikelyFinalAnswer(transcript);
  }

  return "";
}

function extractTextBetweenMarkers(text, startMarker, endMarker) {
  const source = String(text || "");
  const startIndex = source.lastIndexOf(startMarker);

  if (startIndex === -1) {
    return "";
  }

  const afterStart = startIndex + startMarker.length;
  const endIndex = source.indexOf(endMarker, afterStart);

  if (endIndex === -1) {
    return "";
  }

  const cleaned = cleanTerminalText(source.slice(afterStart, endIndex));
  return looksLikePromptEchoContent(cleaned) ? "" : cleaned;
}

function extractLikelyFinalAnswer(text) {
  const cleaned = cleanTerminalText(text);

  if (!cleaned) {
    return "";
  }

  const blocks = cleaned
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return "";
  }

  const preferred = [...blocks]
    .reverse()
    .find((block) => block.length >= 40 && !looksLikeTerminalNoise(block));

  return preferred || blocks[blocks.length - 1];
}

function cleanTerminalText(text) {
  const withoutAnsi = String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "");

  return withoutAnsi
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trimEnd())
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();
}

function looksLikeTerminalNoise(text) {
  const value = String(text || "").trim();

  if (!value) {
    return true;
  }

  return /^(thinking|analyzing|running|executing|processing|loading|waiting)\b/i.test(value);
}

function looksLikePromptEchoContent(text) {
  const value = String(text || "").trim();
  const lowered = value.toLowerCase();

  if (!value) {
    return true;
  }

  if (["与", "and", "正文"].includes(lowered) || ["与", "正文"].includes(value)) {
    return true;
  }

  return /(用户请求|不要输出中间思考|最终只允许输出|标记包裹)/.test(value);
}

function serializeCommandRecord(record) {
  if (!record) {
    return null;
  }

  const summary = summarizeCommandRecord(record);
  return {
    requestId: summary.requestId,
    agentId: summary.agentId,
    operatorUserId: summary.operatorUserId,
    operatorUsername: summary.operatorUsername,
    command: summary.command,
    status: summary.status,
    secureStatus: summary.secureStatus,
    securityError: summary.securityError,
    exitCode: summary.exitCode,
    error: summary.error,
    stdout: summary.stdoutPreview,
    stderr: summary.stderrPreview,
    stdoutChars: summary.stdoutChars,
    stderrChars: summary.stderrChars,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    dispatchedAt: summary.dispatchedAt,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt
  };
}

function serializeTerminalSession(session, options = {}) {
  if (!session) {
    return null;
  }

  const includeOutputs = options.includeOutputs !== false;
  const {
    rawTranscript: _rawTranscript,
    ...rest
  } = session;
  const summary = summarizeTerminalSessionRecord(session);
  const outputs = Array.isArray(session.outputs) ? session.outputs : [];

  return {
    ...rest,
    finalText: summary.finalText,
    finalTextChars: summary.finalTextChars,
    rawCharCount: summary.rawCharCount,
    error: summary.error,
    outputs: includeOutputs ? outputs : []
  };
}

function serializeTerminalSessionUpdate(session) {
  return serializeTerminalSession(session, { includeOutputs: false });
}

function broadcastTerminalSessionUpdate(session) {
  const payload = serializeTerminalSessionUpdate(session);

  if (!payload) {
    return;
  }

  browserHub.broadcast("terminal.session.updated", payload);
}

function rememberAgentBroadcast(agent, reason = "") {
  if (!agent?.agentId) {
    return;
  }

  agentHeartbeatBroadcastState.set(agent.agentId, {
    at: Date.now(),
    reason
  });
}

function shouldBroadcastHeartbeat(agentId) {
  if (!agentId) {
    return false;
  }

  if (agentHeartbeatBroadcastIntervalMs <= 0) {
    return true;
  }

  const previous = agentHeartbeatBroadcastState.get(agentId);

  if (!previous) {
    return true;
  }

  return Date.now() - previous.at >= agentHeartbeatBroadcastIntervalMs;
}

function clearAgentBroadcastState(agentId) {
  if (!agentId) {
    return;
  }

  agentHeartbeatBroadcastState.delete(agentId);
}

function createTerminalSessionPersistTask(record) {
  return async () => {
    await terminalSessionHistoryService.upsertSession(record);
  };
}

function createTerminalSessionTurnSyncTask(record, options = {}) {
  return async () => {
    await terminalSessionHistoryService.syncLatestTurn(record.sessionId, record, options);
  };
}

function clearPendingTerminalSessionPersist(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const pending = pendingTerminalSessionPersists.get(normalizedSessionId) || null;

  if (pending?.timer) {
    clearTimeout(pending.timer);
  }

  pendingTerminalSessionPersists.delete(normalizedSessionId);
  return pending;
}

function clearPendingTerminalSessionTurnSync(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const pending = pendingTerminalSessionTurnSyncs.get(normalizedSessionId) || null;

  if (pending?.timer) {
    clearTimeout(pending.timer);
  }

  pendingTerminalSessionTurnSyncs.delete(normalizedSessionId);
  return pending;
}

function scheduleTerminalSessionTask({
  taskMap,
  sessionId,
  debounceMs,
  taskFactory,
  onError
}) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    return Promise.resolve();
  }

  const pending = taskMap.get(normalizedSessionId);

  if (pending?.timer) {
    clearTimeout(pending.timer);
  }

  let resolveTask;
  let rejectTask;
  const promise =
    pending?.promise ||
    new Promise((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

  taskMap.set(normalizedSessionId, {
    timer: setTimeout(() => {
      void flushScheduledTerminalSessionTask({
        taskMap,
        sessionId: normalizedSessionId,
        taskFactory,
        onError
      });
    }, debounceMs),
    promise,
    resolve: pending?.resolve || resolveTask,
    reject: pending?.reject || rejectTask,
    taskFactory,
    onError
  });

  return promise;
}

async function flushScheduledTerminalSessionTask({
  taskMap,
  sessionId,
  taskFactory,
  onError
}) {
  const pending = taskMap.get(sessionId);

  if (pending?.timer) {
    clearTimeout(pending.timer);
  }

  taskMap.delete(sessionId);

  const runTask = taskFactory || pending?.taskFactory;

  if (typeof runTask !== "function") {
    pending?.resolve?.();
    return;
  }

  try {
    await runTask();
    pending?.resolve?.();
  } catch (error) {
    onError?.(error);
    pending?.resolve?.();
  }
}

function flushTerminalSessionPersist(sessionId) {
  return flushScheduledTerminalSessionTask({
    taskMap: pendingTerminalSessionPersists,
    sessionId: String(sessionId || "").trim()
  });
}

function flushTerminalSessionTurnSync(sessionId) {
  return flushScheduledTerminalSessionTask({
    taskMap: pendingTerminalSessionTurnSyncs,
    sessionId: String(sessionId || "").trim()
  });
}

async function flushTerminalSessionPersistence(sessionId) {
  await Promise.allSettled([
    flushTerminalSessionPersist(sessionId),
    flushTerminalSessionTurnSync(sessionId)
  ]);
}

async function handleCommandHistoryRequest(req, res) {
  try {
    const limit = Number(req.query.limit) || config.commandHistoryLimit;
    const items = await commandHistoryService.listRecent({
      agentId: String(req.query.agentId || ""),
      limit
    });
    res.json({ items });
  } catch (error) {
    logEvent(serverLogger, "error", "command.history_load_failed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message
    });
    res.status(500).json({ message: "加载命令记录失败" });
  }
}

async function handleTerminalSessionHistoryRequest(req, res) {
  try {
    const limit = Number(req.query.limit) || config.terminalSessionHistoryLimit;
    const items = await terminalSessionHistoryService.listRecent(limit);
    res.json({ items });
  } catch (error) {
    logEvent(serverLogger, "error", "terminal.session.history_load_failed", {
      userId: req.auth.user.id,
      username: req.auth.user.username,
      error: error.message
    });
    res.status(500).json({ message: "加载终端会话失败" });
  }
}

async function sendBrowserSnapshot(socket) {
  try {
    const [commands, terminalSessionHistory] = await Promise.all([
      commandHistoryService.listRecent({
        agentId: "",
        limit: config.commandHistoryLimit
      }),
      terminalSessionHistoryService.listRecent(config.terminalSessionHistoryLimit)
    ]);
    const activeTerminalSessions = terminalSessionStore.list(config.terminalSessionHistoryLimit);
    const terminalSessionMap = new Map(
      terminalSessionHistory
        .filter((item) => item?.sessionId)
        .map((item) => [item.sessionId, item])
    );

    for (const session of activeTerminalSessions) {
      terminalSessionMap.set(session.sessionId, serializeTerminalSession(session));
    }

    const terminalSessions = Array.from(terminalSessionMap.values()).sort((left, right) =>
      String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""))
    );

    logEvent(serverLogger, "info", "browser.snapshot_sent", {
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      commandCount: commands.length,
      terminalSessionCount: terminalSessions.length,
      activeTerminalSessionCount: activeTerminalSessions.length
    });

    browserHub.send(socket, "snapshot", {
      agents: agentRegistry.list(),
      commands,
      terminalSessions
    });
  } catch (error) {
    logEvent(serverLogger, "error", "browser.snapshot_failed", {
      userId: socket.auth.user.id,
      username: socket.auth.user.username,
      error: error.message
    });
  }
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

function persistCommandRecord(record) {
  if (!record?.requestId) {
    return Promise.resolve();
  }

  return commandHistoryService.update(record).catch((error) => {
    logEvent(serverLogger, "error", "command.persistence_failed", {
      requestId: record.requestId,
      error: error.message
    });
  });
}

function persistTerminalSessionRecord(record, options = {}) {
  if (!record?.sessionId) {
    return Promise.resolve();
  }

  const sessionId = String(record.sessionId || "").trim();
  const immediate =
    options.immediate === true ||
    isTerminalSessionClosedStatus(record.status) ||
    terminalSessionPersistDebounceMs <= 0;
  const taskFactory = createTerminalSessionPersistTask(record);
  const onError = (error) => {
    logEvent(serverLogger, "error", "terminal.session.persistence_failed", {
      sessionId,
      error: error.message
    });
  };

  if (immediate) {
    return flushScheduledTerminalSessionTask({
      taskMap: pendingTerminalSessionPersists,
      sessionId,
      taskFactory,
      onError
    });
  }

  return scheduleTerminalSessionTask({
    taskMap: pendingTerminalSessionPersists,
    sessionId,
    debounceMs: terminalSessionPersistDebounceMs,
    taskFactory,
    onError
  });
}

function maybeRecordTerminalSessionTurn(session, logicalInput, rawInput) {
  if (!session?.sessionId || !["final_only", "hybrid"].includes(String(session.displayMode || ""))) {
    return;
  }

  const candidate = String(logicalInput || "").trim() || extractLogicalInputFromWrappedPrompt(rawInput);

  if (!candidate) {
    return;
  }

  void terminalSessionHistoryService
    .beginTurn(session.sessionId, candidate, new Date().toISOString())
    .then(() =>
      maybeSyncTerminalSessionTurn(session, {
        allowEmpty: isTerminalSessionClosedStatus(session.status)
      })
    )
    .catch((error) => {
      logEvent(serverLogger, "error", "terminal.session.turn_begin_failed", {
        sessionId: session.sessionId,
        error: error.message
      });
    });
}

function maybeSyncTerminalSessionTurn(session, options = {}) {
  if (!session?.sessionId || !["final_only", "hybrid"].includes(String(session.displayMode || ""))) {
    return Promise.resolve();
  }

  const sessionId = String(session.sessionId || "").trim();
  const allowEmpty = options.allowEmpty === true;
  const immediate =
    options.immediate === true || allowEmpty || terminalSessionTurnSyncDebounceMs <= 0;
  const taskFactory = createTerminalSessionTurnSyncTask(session, {
    ...options,
    allowEmpty
  });
  const onError = (error) => {
    logEvent(serverLogger, "error", "terminal.session.turn_finalize_failed", {
      sessionId,
      error: error.message
    });
  };

  if (immediate) {
    return flushScheduledTerminalSessionTask({
      taskMap: pendingTerminalSessionTurnSyncs,
      sessionId,
      taskFactory,
      onError
    });
  }

  return scheduleTerminalSessionTask({
    taskMap: pendingTerminalSessionTurnSyncs,
    sessionId,
    debounceMs: terminalSessionTurnSyncDebounceMs,
    taskFactory,
    onError
  });
}

function extractLogicalInputFromWrappedPrompt(input) {
  const source = String(input || "");
  const marker = "用户请求：";
  const markerIndex = source.lastIndexOf(marker);

  if (markerIndex === -1) {
    return "";
  }

  return source.slice(markerIndex + marker.length).trim();
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
