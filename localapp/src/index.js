import process from "node:process";

import { loadConfig } from "./config.js";
import { AgentClient } from "./agent-client.js";
import { configureLogging, logEvent } from "./logger.js";

const config = loadConfig();
const loggers = configureLogging(config);

logEvent(loggers.agentLogger, "info", "agent.boot", {
  agentId: config.agentId,
  serverWsUrl: config.serverWsUrl,
  logDir: loggers.logDir,
  authPrivateKeyPath: config.authPrivateKeyPath,
  webserverSignPublicKeyPath: config.webserverSignPublicKeyPath
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

const agent = new AgentClient(config, loggers);

agent.start();

function formatUnknownError(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      stack: reason.stack || ""
    };
  }

  return String(reason);
}
