import http from "node:http";
import { randomUUID } from "node:crypto";

import { logEvent } from "./logger.js";

export class LocalDebugServer {
  constructor(config, loggers, executionGateway, profileRegistry) {
    this.config = config;
    this.agentLogger = loggers.agentLogger;
    this.commandLogger = loggers.commandLogger;
    this.executionGateway = executionGateway;
    this.profileRegistry = profileRegistry;
    this.server = null;
  }

  start() {
    if (!this.config.localDebugServerEnabled) {
      return;
    }

    if (!this.config.localDebugToken) {
      throw new Error("LOCAL_DEBUG_TOKEN is required when LOCAL_DEBUG_SERVER_ENABLED=true");
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.listen(this.config.localDebugServerPort, this.config.localDebugServerHost, () => {
      logEvent(this.agentLogger, "info", "debug.server.started", {
        host: this.config.localDebugServerHost,
        port: this.config.localDebugServerPort
      });
    });
  }

  async handleRequest(req, res) {
    if (!this.requireAuth(req, res)) {
      return;
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");

    try {
      const body = ["POST", "PATCH", "PUT"].includes(String(req.method || "").toUpperCase())
        ? await readJsonBody(req)
        : {};

      if (req.method === "GET" && url.pathname === "/api/debug/health") {
        this.writeJson(res, 200, {
          ok: true,
          now: new Date().toISOString(),
          profiles: this.profileRegistry.listProfiles()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/debug/commands") {
        const command = String(body.command || "").trim();

        if (!command) {
          this.writeJson(res, 400, { message: "command is required" });
          return;
        }

        logEvent(this.commandLogger, "info", "debug.command.requested", {
          command
        });

        const result = await this.executionGateway.executeCommand(command);
        this.writeJson(res, 200, {
          item: {
            requestId: randomUUID(),
            command,
            ...result
          }
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/debug/terminal-sessions") {
        this.writeJson(res, 200, {
          items: this.executionGateway.listTerminalSessions()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/debug/terminal-sessions") {
        const profile = String(body.profile || "default_shell_session").trim();
        const session = this.executionGateway.createTerminalSession({
          sessionId: randomUUID(),
          agentId: this.config.agentId,
          requestId: randomUUID(),
          source: "local-debug",
          profileName: profile,
          cwd: body.cwd,
          env: body.env || {},
          cols: Number(body.cols) || 120,
          rows: Number(body.rows) || 30
        });

        this.writeJson(res, 201, {
          item: session
        });
        return;
      }

      const sessionIdMatch = /^\/api\/debug\/terminal-sessions\/([^/]+)$/.exec(url.pathname);

      if (req.method === "GET" && sessionIdMatch) {
        const session = this.executionGateway.getTerminalSession(sessionIdMatch[1]);

        if (!session) {
          this.writeJson(res, 404, { message: "session not found" });
          return;
        }

        this.writeJson(res, 200, { item: session });
        return;
      }

      const inputMatch = /^\/api\/debug\/terminal-sessions\/([^/]+)\/input$/.exec(url.pathname);

      if (req.method === "POST" && inputMatch) {
        const input = String(body.input || "");

        if (!input) {
          this.writeJson(res, 400, { message: "input is required" });
          return;
        }

        const session = this.executionGateway.writeTerminalSessionInput(inputMatch[1], input);
        this.writeJson(res, 200, { item: session });
        return;
      }

      const terminateMatch =
        /^\/api\/debug\/terminal-sessions\/([^/]+)\/terminate$/.exec(url.pathname);

      if (req.method === "POST" && terminateMatch) {
        const session = this.executionGateway.terminateTerminalSession(
          terminateMatch[1],
          "local_debug_terminate"
        );
        this.writeJson(res, 200, { item: session });
        return;
      }

      this.writeJson(res, 404, { message: "not found" });
    } catch (error) {
      logEvent(this.commandLogger, "error", "debug.request_failed", {
        method: req.method || "",
        path: url.pathname,
        error: error.message
      });
      this.writeJson(res, 400, { message: error.message || "debug request failed" });
    }
  }

  requireAuth(req, res) {
    if (!this.config.localDebugToken) {
      return true;
    }

    const authorization = String(req.headers.authorization || "");
    const expected = `Bearer ${this.config.localDebugToken}`;

    if (authorization !== expected) {
      this.writeJson(res, 401, { message: "unauthorized" });
      return false;
    }

    return true;
  }

  writeJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error("invalid json body"));
      }
    });

    req.on("error", reject);
  });
}
