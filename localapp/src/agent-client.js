import os from "node:os";
import process from "node:process";
import WebSocket from "ws";

import { normalizeCommandForExecution, runCommand } from "./command-runner.js";
import { logEvent } from "./logger.js";

function createMessage(type, payload) {
  return JSON.stringify({
    type,
    payload,
    sentAt: new Date().toISOString()
  });
}

export class AgentClient {
  constructor(config, loggers) {
    this.config = config;
    this.agentLogger = loggers.agentLogger;
    this.commandLogger = loggers.commandLogger;
    this.socket = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.commandQueue = [];
    this.processing = false;
    this.outbox = [];
  }

  start() {
    this.connect();
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

    this.socket.on("close", () => {
      logEvent(this.agentLogger, "warn", "agent.disconnected", {
        agentId: this.config.agentId
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
    if (message.type !== "command.execute") {
      return;
    }

    this.commandQueue.push(message.payload);
    logEvent(this.commandLogger, "info", "command.received", {
      requestId: message.payload.requestId,
      agentId: this.config.agentId,
      command: message.payload.command,
      queueLength: this.commandQueue.length
    });
    this.processQueue();
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
        executedCommand
      });

      this.send(
        "command.started",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          startedAt: new Date().toISOString()
        },
        true
      );

      const result = await runCommand(payload.command, this.config);

      logEvent(
        this.commandLogger,
        result.status === "completed" ? "info" : "warn",
        "command.finished",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          command: payload.command,
          ...result
        }
      );

      this.send(
        "command.finished",
        {
          requestId: payload.requestId,
          agentId: this.config.agentId,
          command: payload.command,
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
        error: error.message
      });
    } finally {
      this.processing = false;
      this.processQueue();
    }
  }

  sendRegister() {
    logEvent(this.agentLogger, "info", "agent.registering", {
      agentId: this.config.agentId,
      label: this.config.agentLabel
    });

    this.send("agent.register", {
      agentId: this.config.agentId,
      label: this.config.agentLabel,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      pid: process.pid
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
}
