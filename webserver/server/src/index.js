import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import express from "express";
import WebSocket, { WebSocketServer } from "ws";

import { loadConfig } from "./config.js";
import { configureLogging, logEvent } from "./logger.js";
import { BrowserHub } from "./realtime/browser-hub.js";
import { AgentRegistry } from "./state/agent-registry.js";
import { CommandStore } from "./state/command-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = loadConfig();
const loggers = configureLogging(config);
const { serverLogger, commandLogger } = loggers;
const app = express();
const server = http.createServer(app);
const agentRegistry = new AgentRegistry();
const commandStore = new CommandStore(config.commandHistoryLimit);
const browserHub = new BrowserHub();

const agentSocketServer = new WebSocketServer({ noServer: true });
const browserSocketServer = new WebSocketServer({ noServer: true });

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/config", (_req, res) => {
  res.json({
    controlTokenRequired: Boolean(config.controlToken)
  });
});

app.get("/api/agents", (req, res) => {
  if (!authorizeControlRequest(req)) {
    logUnauthorizedControlAccess(req, "api.agents");
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  res.json({ items: agentRegistry.list() });
});

app.get("/api/commands", (req, res) => {
  if (!authorizeControlRequest(req)) {
    logUnauthorizedControlAccess(req, "api.commands");
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const limit = Number(req.query.limit) || config.commandHistoryLimit;

  res.json({
    items: commandStore.list({
      agentId: req.query.agentId || "",
      limit
    })
  });
});

app.post("/api/commands", (req, res) => {
  if (!authorizeControlRequest(req)) {
    logUnauthorizedControlAccess(req, "api.commands.create");
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const command = req.body?.command?.trim();
  const agentId = req.body?.agentId?.trim();

  if (!agentId || !command) {
    logEvent(commandLogger, "warn", "command.invalid_request", {
      ...getRequestContext(req),
      agentId,
      command
    });
    res.status(400).json({ message: "agentId and command are required" });
    return;
  }

  const record = commandStore.create({ agentId, command });
  const dispatched = isAgentSocketOpen(agentId);

  logEvent(commandLogger, "info", "command.requested", {
    requestId: record.requestId,
    agentId,
    command,
    queued: !dispatched,
    ...getRequestContext(req)
  });

  dispatchCommand(record);

  browserHub.broadcast("command.updated", record);

  res.status(dispatched ? 202 : 201).json({
    item: record,
    queued: !dispatched
  });
});

const clientDistPath = path.resolve(__dirname, "../../client/dist");

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get(/^(?!\/api)(?!\/ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/ws/agent") {
    if (!authorizeAgentRequest(url)) {
      logEvent(serverLogger, "warn", "agent.websocket_unauthorized", {
        agentId: url.searchParams.get("agentId") || "",
        ip: request.socket.remoteAddress || ""
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
    if (!authorizeControlRequest(request, url.searchParams.get("token"))) {
      logEvent(serverLogger, "warn", "browser.websocket_unauthorized", {
        ip: request.socket.remoteAddress || "",
        userAgent: request.headers["user-agent"] || ""
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    browserSocketServer.handleUpgrade(request, socket, head, (ws) => {
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

    logEvent(serverLogger, "warn", "agent.websocket_disconnected", {
      agentId,
      affectedCommands: changedCommands.length
    });

    if (agent) {
      browserHub.broadcast("agent.updated", agent);
    }

    for (const command of changedCommands) {
      browserHub.broadcast("command.updated", command);
    }
  });
});

browserSocketServer.on("connection", (socket) => {
  browserHub.add(socket);
  logEvent(serverLogger, "info", "browser.websocket_connected", {
    subscribers: browserHub.sockets.size
  });
  browserHub.send(socket, "snapshot", {
    agents: agentRegistry.list(),
    commands: commandStore.list({
      agentId: "",
      limit: config.commandHistoryLimit
    })
  });

  socket.on("close", () => {
    browserHub.remove(socket);
    logEvent(serverLogger, "info", "browser.websocket_disconnected", {
      subscribers: browserHub.sockets.size
    });
  });
});

server.listen(config.httpPort, () => {
  logEvent(serverLogger, "info", "server.started", {
    httpPort: config.httpPort,
    logDir: loggers.logDir
  });
});

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
      arch: agent.arch
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
      exitCode: message.payload.exitCode,
      stdout: message.payload.stdout || "",
      stderr: message.payload.stderr || "",
      error: message.payload.error || "",
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
          startedAt: record.startedAt,
          completedAt: record.completedAt
        }
      );
      browserHub.broadcast("command.updated", record);
    }
  }
}

function dispatchQueuedCommands(agentId) {
  for (const command of commandStore.listQueued(agentId)) {
    dispatchCommand(command);
  }
}

function dispatchCommand(command) {
  const socket = agentRegistry.getSocket(command.agentId);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logEvent(commandLogger, "info", "command.queued", {
      requestId: command.requestId,
      agentId: command.agentId,
      command: command.command
    });
    return false;
  }

  const dispatchedAt = new Date().toISOString();

  commandStore.update(command.requestId, {
    status: "dispatched",
    dispatchedAt,
    error: ""
  });

  logEvent(commandLogger, "info", "command.dispatched", {
    requestId: command.requestId,
    agentId: command.agentId,
    command: command.command,
    dispatchedAt
  });

  socket.send(
    JSON.stringify({
      type: "command.execute",
      payload: {
        requestId: command.requestId,
        agentId: command.agentId,
        command: command.command,
        createdAt: command.createdAt
      },
      sentAt: new Date().toISOString()
    })
  );

  return true;
}

function isAgentSocketOpen(agentId) {
  const socket = agentRegistry.getSocket(agentId);
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function authorizeControlRequest(req, tokenFromQuery = null) {
  if (!config.controlToken) {
    return true;
  }

  const token = req.headers?.["x-control-token"] || tokenFromQuery || "";
  return token === config.controlToken;
}

function authorizeAgentRequest(url) {
  if (!config.agentSharedToken) {
    return true;
  }

  return url.searchParams.get("token") === config.agentSharedToken;
}

function getRequestContext(req) {
  return {
    ip: req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "",
    userAgent: req.headers?.["user-agent"] || ""
  };
}

function logUnauthorizedControlAccess(req, scope) {
  logEvent(serverLogger, "warn", "control.unauthorized", {
    scope,
    ...getRequestContext(req)
  });
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
