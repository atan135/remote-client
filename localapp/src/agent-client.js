import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { normalizeCommandForExecution } from "./command-runner.js";
import { logEvent } from "./logger.js";
import { SecureCommandService } from "./security/secure-command-service.js";

function createMessage(type, payload) {
  return JSON.stringify({
    type,
    payload,
    sentAt: new Date().toISOString()
  });
}

export class AgentClient {
  constructor(config, loggers, executionGateway, profileRegistry = null) {
    this.config = config;
    this.agentLogger = loggers.agentLogger;
    this.commandLogger = loggers.commandLogger;
    this.executionGateway = executionGateway;
    this.profileRegistry = profileRegistry;
    this.socket = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.commandQueue = [];
    this.processing = false;
    this.outbox = [];
    this.secureCommandService = new SecureCommandService(config);
  }

  start() {
    this.connect();
  }

  inspectSecurityKeyMaterial() {
    return this.secureCommandService.inspectLocalKeyMaterial();
  }

  connect() {
    const url = new URL(this.config.serverWsUrl);
    url.searchParams.set("agentId", this.config.agentId);

    if (this.config.agentSharedToken) {
      url.searchParams.set("token", this.config.agentSharedToken);
    }

    logEvent(this.agentLogger, "info", "agent.connecting", {
      agentId: this.config.agentId,
      serverWsUrl: url.toString()
    });

    this.socket = new WebSocket(url);

    this.socket.on("open", () => {
      logEvent(this.agentLogger, "info", "agent.connected", {
        agentId: this.config.agentId
      });
      this.flushReconnectTimer();
      this.startHeartbeat();
      this.sendRegister();
      this.flushOutbox();
      this.processQueue();
    });

    this.socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        this.handleMessage(message);
      } catch (error) {
        logEvent(this.agentLogger, "error", "agent.invalid_message", {
          agentId: this.config.agentId,
          error: error.message,
          raw: String(raw)
        });
      }
    });

    this.socket.on("close", (code, reasonBuffer) => {
      logEvent(this.agentLogger, "warn", "agent.disconnected", {
        agentId: this.config.agentId,
        closeCode: code,
        closeReason: normalizeSocketCloseReason(reasonBuffer)
      });
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.socket.on("error", (error) => {
      logEvent(this.agentLogger, "error", "agent.websocket_error", {
        agentId: this.config.agentId,
        error: error.message
      });
    });
  }

  handleMessage(message) {
    if (message.type === "command.execute.secure") {
      this.handleSecureCommand(message);
      return;
    }

    if (message.type === "terminal.session.create.secure") {
      this.handleSecureTerminalSessionCreate(message);
      return;
    }

    if (message.type === "terminal.session.input.secure") {
      this.handleSecureTerminalSessionInput(message);
      return;
    }

    if (message.type === "terminal.session.resize.secure") {
      this.handleSecureTerminalSessionResize(message);
      return;
    }

    if (message.type === "terminal.session.terminate.secure") {
      this.handleSecureTerminalSessionTerminate(message);
      return;
    }

    if (message.type === "command.execute") {
      this.rejectInsecureCommand(message.payload || {});
      return;
    }
  }

  async processQueue() {
    if (this.processing || this.commandQueue.length === 0) {
      return;
    }

    this.processing = true;
    const payload = this.commandQueue.shift();
    const executedCommand = normalizeCommandForExecution(payload.command);

    try {
      logEvent(this.commandLogger, "info", "command.started", {
        requestId: payload.requestId,
        agentId: this.config.agentId,
        command: payload.command,
        secureStatus: payload.secureStatus || "verified",
        executedCommand
      });

      this.send(
        "command.started",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          secureStatus: payload.secureStatus || "verified",
          startedAt: new Date().toISOString()
        },
        true
      );

      const result = await this.executionGateway.executeCommand(payload.command);

      logEvent(
        this.commandLogger,
        result.status === "completed" ? "info" : "warn",
        "command.finished",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          command: payload.command,
          secureStatus: payload.secureStatus || "verified",
          securityError: "",
          ...result
        }
      );

      this.send(
        "command.finished",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          command: payload.command,
          secureStatus: payload.secureStatus || "verified",
          securityError: "",
          ...result
        },
        true
      );
    } catch (error) {
      this.send(
        "command.finished",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          command: payload.command,
          status: "failed",
          secureStatus: payload.secureStatus || "verified",
          securityError: error.message,
          exitCode: null,
          stdout: "",
          stderr: "",
          error: error.message,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        },
        true
      );

      logEvent(this.commandLogger, "error", "command.execution_exception", {
        requestId: payload.requestId,
        agentId: this.config.agentId,
        command: payload.command,
        secureStatus: payload.secureStatus || "verified",
        error: error.message
      });
    } finally {
      this.processing = false;
      this.processQueue();
    }
  }

  sendRegister() {
    const activeTerminalSessions = this.listActiveRemoteTerminalSessions();

    logEvent(this.agentLogger, "info", "agent.registering", {
      agentId: this.config.agentId,
      label: this.config.agentLabel,
      activeRemoteTerminalSessionCount: activeTerminalSessions.length,
      presetCommandCount: Array.isArray(this.config.presetCommands)
        ? this.config.presetCommands.length
        : 0,
      commonWorkingDirectoryCount: Array.isArray(this.config.commonWorkingDirectories)
        ? this.config.commonWorkingDirectories.length
        : 0
    });

    this.send("agent.register", {
      agentId: this.config.agentId,
      label: this.config.agentLabel,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      pid: process.pid,
      activeTerminalSessions,
      terminalProfiles: this.listTerminalProfiles(),
      presetCommands: Array.isArray(this.config.presetCommands)
        ? this.config.presetCommands.map((item) => ({
            label: String(item?.label || "").trim(),
            command: String(item?.command || "").trim()
          }))
        : [],
      commonWorkingDirectories: Array.isArray(this.config.commonWorkingDirectories)
        ? [...this.config.commonWorkingDirectories]
        : []
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send("agent.heartbeat", {
        agentId: this.config.agentId,
        lastSeenAt: new Date().toISOString()
      });
    }, this.config.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    logEvent(this.agentLogger, "warn", "agent.reconnect_scheduled", {
      agentId: this.config.agentId,
      reconnectIntervalMs: this.config.reconnectIntervalMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectIntervalMs);
  }

  flushReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  flushOutbox() {
    if (this.outbox.length > 0) {
      logEvent(this.agentLogger, "info", "agent.flush_outbox", {
        agentId: this.config.agentId,
        count: this.outbox.length
      });
    }

    while (this.outbox.length > 0 && this.isOpen()) {
      const message = this.outbox.shift();
      this.socket.send(message);
    }
  }

  send(type, payload, persistIfOffline = false) {
    const message = createMessage(type, payload);

    if (type === "terminal.session.output") {
      logEvent(this.commandLogger, "info", "terminal.session.output_dispatch", {
        sessionId: String(payload?.sessionId || ""),
        agentId: this.config.agentId,
        seq: Number(payload?.seq || 0),
        chunkLength: String(payload?.chunk || "").length,
        persistIfOffline,
        socketOpen: this.isOpen(),
        bufferedAmount: this.socket?.bufferedAmount ?? 0,
        outboxSize: this.outbox.length
      });
    }

    if (this.isOpen()) {
      this.socket.send(message);
      return;
    }

    if (persistIfOffline) {
      this.outbox.push(message);
      logEvent(this.agentLogger, "warn", "agent.message_buffered", {
        agentId: this.config.agentId,
        type,
        outboxSize: this.outbox.length
      });
    }
  }

  isOpen() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  handleSecureCommand(message) {
    try {
      const unwrapped = this.secureCommandService.unwrapMessage(message, {
        expectedType: "command.execute.secure",
        requiredFields: ["command"]
      });
      const payload = {
        ...unwrapped.payload,
        secureStatus: "verified",
        webserverSignFingerprint: unwrapped.meta.webserverSignFingerprint,
        trustedWebserverSignFingerprint: unwrapped.meta.trustedWebserverSignFingerprint,
        claimedWebserverSignFingerprint: unwrapped.meta.claimedWebserverSignFingerprint,
        authCodeFingerprint: unwrapped.meta.authCodeFingerprint,
        localAuthPublicKeyFingerprint: unwrapped.meta.localAuthPublicKeyFingerprint,
        authCodeId: unwrapped.meta.authCodeId
      };

      this.commandQueue.push(payload);
      logEvent(this.commandLogger, "info", "command.received_secure", {
        requestId: payload.requestId,
        agentId: this.config.agentId,
        command: payload.command,
        authCodeId: payload.authCodeId,
        authCodeFingerprint: payload.authCodeFingerprint,
        localAuthPublicKeyFingerprint: payload.localAuthPublicKeyFingerprint,
        webserverSignFingerprint: payload.webserverSignFingerprint,
        claimedWebserverSignFingerprint: payload.claimedWebserverSignFingerprint,
        queueLength: this.commandQueue.length
      });
      this.processQueue();
    } catch (error) {
      this.rejectSecureCommand(message.payload || {}, error);
    }
  }

  handleSecureTerminalSessionCreate(message) {
    let payload;

    try {
      const unwrapped = this.secureCommandService.unwrapMessage(message, {
        expectedType: "terminal.session.create.secure",
        requiredFields: ["profile", "sessionId"]
      });
      payload = unwrapped.payload;
      this.executionGateway.createTerminalSession({
        sessionId: String(payload.sessionId || randomUUID()),
        agentId: this.config.agentId,
        requestId: payload.requestId,
        source: "remote",
        profileName: payload.profile,
        cwd: payload.cwd || payload.payload?.cwd,
        env: payload.env || payload.payload?.env || {},
        cols: payload.cols || payload.payload?.cols,
        rows: payload.rows || payload.payload?.rows,
        eventSink: ({ type, payload: eventPayload, persistIfOffline }) => {
          this.send(type, eventPayload, persistIfOffline);
        }
      });
    } catch (error) {
      this.send(
        "terminal.session.error",
        {
          requestId: String(payload?.requestId || message?.payload?.requestId || ""),
          agentId: this.config.agentId,
          sessionId: String(payload?.sessionId || ""),
          error: error.message
        },
        true
      );

      logEvent(this.commandLogger, "warn", "terminal.session.create_rejected", {
        requestId: String(payload?.requestId || message?.payload?.requestId || ""),
        agentId: this.config.agentId,
        error: error.message
      });
    }
  }

  handleSecureTerminalSessionInput(message) {
    let payload;

    try {
      const unwrapped = this.secureCommandService.unwrapMessage(message, {
        expectedType: "terminal.session.input.secure",
        requiredFields: ["sessionId", "input"]
      });
      payload = unwrapped.payload;
      this.executionGateway.writeTerminalSessionInput(
        String(payload.sessionId),
        String(payload.input)
      );
    } catch (error) {
      this.send(
        "terminal.session.error",
        {
          requestId: String(payload?.requestId || message?.payload?.requestId || ""),
          agentId: this.config.agentId,
          sessionId: String(payload?.sessionId || ""),
          error: error.message
        },
        true
      );
    }
  }

  handleSecureTerminalSessionTerminate(message) {
    let payload;

    try {
      const unwrapped = this.secureCommandService.unwrapMessage(message, {
        expectedType: "terminal.session.terminate.secure",
        requiredFields: ["sessionId"]
      });
      payload = unwrapped.payload;
      this.executionGateway.terminateTerminalSession(
        String(payload.sessionId),
        "remote_terminate"
      );
    } catch (error) {
      this.send(
        "terminal.session.error",
        {
          requestId: String(payload?.requestId || message?.payload?.requestId || ""),
          agentId: this.config.agentId,
          sessionId: String(payload?.sessionId || ""),
          error: error.message
        },
        true
      );
    }
  }

  handleSecureTerminalSessionResize(message) {
    let payload;

    try {
      const unwrapped = this.secureCommandService.unwrapMessage(message, {
        expectedType: "terminal.session.resize.secure",
        requiredFields: ["sessionId", "cols", "rows"]
      });
      payload = unwrapped.payload;
      this.executionGateway.resizeTerminalSession(
        String(payload.sessionId),
        Number(payload.cols),
        Number(payload.rows)
      );
    } catch (error) {
      this.send(
        "terminal.session.error",
        {
          requestId: String(payload?.requestId || message?.payload?.requestId || ""),
          agentId: this.config.agentId,
          sessionId: String(payload?.sessionId || ""),
          error: error.message
        },
        true
      );
    }
  }

  rejectInsecureCommand(payload) {
    const error = new Error("已拒绝未加密命令，当前 agent 仅接受 command.execute.secure");
    const requestId = String(payload.requestId || "");
    const now = new Date().toISOString();

    logEvent(this.commandLogger, "warn", "command.insecure_rejected", {
      requestId,
      agentId: this.config.agentId,
      error: error.message
    });

    if (!requestId) {
      return;
    }

    this.send(
      "command.finished",
      {
        requestId,
        agentId: this.config.agentId,
        command: String(payload.command || ""),
        status: "failed",
        secureStatus: "rejected",
        securityError: error.message,
        exitCode: null,
        stdout: "",
        stderr: "",
        error: error.message,
        startedAt: now,
        completedAt: now
      },
      true
    );
  }

  rejectSecureCommand(payload, error) {
    const requestId = String(payload.requestId || "");
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    const details =
      error && typeof error === "object" && error.details && typeof error.details === "object"
        ? error.details
        : {};

    logEvent(this.commandLogger, "warn", "command.secure_rejected", {
      requestId,
      agentId: this.config.agentId,
      authCodeId: payload.authCodeId ?? null,
      errorCode: error?.code || "",
      error: message,
      ...details
    });

    if (!requestId) {
      return;
    }

    this.send(
      "command.finished",
      {
        requestId,
        agentId: this.config.agentId,
        command: "",
        status: "failed",
        secureStatus: "rejected",
        securityError: message,
        exitCode: null,
        stdout: "",
        stderr: "",
        error: message,
        startedAt: now,
        completedAt: now
      },
      true
    );
  }

  listTerminalProfiles() {
    if (!this.profileRegistry || typeof this.profileRegistry.listProfiles !== "function") {
      return [];
    }

    return this.profileRegistry
      .listProfiles()
      .filter((profile) => profile.runner === "pty");
  }

  listActiveRemoteTerminalSessions() {
    if (
      !this.executionGateway ||
      typeof this.executionGateway.listActiveRemoteTerminalSessions !== "function"
    ) {
      return [];
    }

    return this.executionGateway.listActiveRemoteTerminalSessions().map((session) => ({
      sessionId: String(session?.sessionId || ""),
      requestId: String(session?.requestId || ""),
      agentId: String(session?.agentId || this.config.agentId),
      source: String(session?.source || "remote"),
      profile: String(session?.profile || ""),
      sessionType: String(session?.sessionType || "pty"),
      cwd: String(session?.cwd || ""),
      status: String(session?.status || ""),
      pid: typeof session?.pid === "number" ? session.pid : null,
      startedAt: session?.startedAt || null,
      lastInputAt: session?.lastInputAt || null,
      lastOutputAt: session?.lastOutputAt || null,
      closedAt: session?.closedAt || null,
      exitCode: typeof session?.exitCode === "number" ? session.exitCode : null,
      error: String(session?.error || ""),
      cols: typeof session?.cols === "number" ? session.cols : null,
      rows: typeof session?.rows === "number" ? session.rows : null,
      createdAt: session?.createdAt || null,
      updatedAt: session?.updatedAt || session?.lastOutputAt || session?.createdAt || null,
      outputs: Array.isArray(session?.outputs)
        ? session.outputs.map((output) => ({
            sessionId: String(output?.sessionId || session?.sessionId || ""),
            stream: String(output?.stream || "stdout"),
            chunk: String(output?.chunk || ""),
            seq: Number(output?.seq || 0),
            sentAt: output?.sentAt || null
          }))
        : []
    }));
  }
}

function normalizeSocketCloseReason(reasonBuffer) {
  const reason = Buffer.isBuffer(reasonBuffer)
    ? reasonBuffer.toString("utf8")
    : String(reasonBuffer || "");

  return reason.trim();
}
