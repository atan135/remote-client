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
const agent = new AgentClient(config, loggers, executionGateway, profileRegistry);
const localDebugServer = new LocalDebugServer(config, loggers, executionGateway, profileRegistry);

logEvent(loggers.agentLogger, "info", "agent.boot", {
  agentId: config.agentId,
  serverWsUrl: config.serverWsUrl,
  envFilePath: config.envFilePath,
  logDir: loggers.logDir,
  presetCommandCount: Array.isArray(config.presetCommands) ? config.presetCommands.length : 0,
  authPrivateKeyPath: config.authPrivateKeyPath,
  webserverSignPublicKeyPath: config.webserverSignPublicKeyPath,
  webserverSignPublicKeyEnvVarName: config.webserverSignPublicKeyEnvVarName,
  webserverSignPublicKeyPathSource: config.webserverSignPublicKeyPathSource,
  webserverSignPublicKeyConfiguredInEnvFile: config.webserverSignPublicKeyConfiguredInEnvFile,
  windowsUseConpty: config.windowsUseConpty,
  windowsUseConptyDll: config.windowsUseConptyDll,
  localDebugServerEnabled: config.localDebugServerEnabled
});

if (!config.webserverSignPublicKeyConfiguredInEnvFile) {
  logEvent(loggers.agentLogger, "warn", "security.local_key_env_check", {
    envFilePath: config.envFilePath,
    envVarName: config.webserverSignPublicKeyEnvVarName,
    configuredInEnvFile: config.webserverSignPublicKeyConfiguredInEnvFile,
    effectivePath: config.webserverSignPublicKeyPath,
    pathSource: config.webserverSignPublicKeyPathSource,
    message:
      "未在 localapp/.env 中显式配置服务端签名公钥路径，切换本地/线上服务端时请优先检查该配置"
  });
}

try {
  const securityKeyMaterial = agent.inspectSecurityKeyMaterial();
  logEvent(loggers.agentLogger, "info", "security.local_key_ready", securityKeyMaterial);
} catch (error) {
  logEvent(loggers.agentLogger, "warn", "security.local_key_invalid", {
    errorCode: error?.code || "",
    error: error instanceof Error ? error.message : String(error),
    ...(error?.details && typeof error.details === "object" ? error.details : {})
  });
}

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
