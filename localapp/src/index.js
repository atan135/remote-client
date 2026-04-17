import process from "node:process";

import { loadConfig } from "./config.js";
import { AgentClient } from "./agent-client.js";
import { LocalDebugServer } from "./local-debug-server.js";
import { configureLogging, logEvent } from "./logger.js";
import { ExecutionGateway } from "./runtime/execution-gateway.js";
import { PtySessionManager } from "./runtime/pty-session-manager.js";
import { SessionStore } from "./runtime/session-store.js";
import { ToolProfileRegistry } from "./runtime/tool-profile-registry.js";

const config = loadConfig();
const loggers = configureLogging(config);
const profileRegistry = new ToolProfileRegistry(config);
const sessionStore = new SessionStore(config.maxTerminalSessions * 4, config.sessionOutputLimit);
const ptySessionManager = new PtySessionManager(config, loggers, profileRegistry, sessionStore);
const executionGateway = new ExecutionGateway(config, ptySessionManager);

logEvent(loggers.agentLogger, "info", "agent.boot", {
  agentId: config.agentId,
  serverWsUrl: config.serverWsUrl,
  logDir: loggers.logDir,
  authPrivateKeyPath: config.authPrivateKeyPath,
  webserverSignPublicKeyPath: config.webserverSignPublicKeyPath,
  localDebugServerEnabled: config.localDebugServerEnabled
});

process.on("uncaughtException", (error) => {
  logEvent(loggers.agentLogger, "error", "process.uncaught_exception", {
    error: error.message,
    stack: error.stack || ""
  });
});

process.on("unhandledRejection", (reason) => {
  logEvent(loggers.agentLogger, "error", "process.unhandled_rejection", {
    reason: formatUnknownError(reason)
  });
});

const agent = new AgentClient(config, loggers, executionGateway, profileRegistry);
const localDebugServer = new LocalDebugServer(config, loggers, executionGateway, profileRegistry);

agent.start();
localDebugServer.start();

function formatUnknownError(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      stack: reason.stack || ""
    };
  }

  return String(reason);
}
