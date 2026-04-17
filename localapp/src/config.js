import dotenv from "dotenv";
import os from "node:os";

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function toList(value) {
  return String(value || "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const hostname = os.hostname();

  return {
    serverWsUrl: process.env.SERVER_WS_URL || "ws://localhost:3100/ws/agent",
    agentId: process.env.AGENT_ID || hostname,
    agentLabel: process.env.AGENT_LABEL || hostname,
    agentSharedToken: process.env.AGENT_SHARED_TOKEN || "",
    heartbeatIntervalMs: toNumber(process.env.HEARTBEAT_INTERVAL_MS, 15000),
    reconnectIntervalMs: toNumber(process.env.RECONNECT_INTERVAL_MS, 5000),
    commandTimeoutMs: toNumber(process.env.COMMAND_TIMEOUT_MS, 120000),
    maxBufferBytes: toNumber(process.env.MAX_BUFFER_BYTES, 1024 * 1024),
    logLevel: process.env.LOG_LEVEL || "info",
    logDir: process.env.LOG_DIR || "logs",
    windowsOutputEncoding: process.env.WINDOWS_OUTPUT_ENCODING || "cp936",
    authPrivateKeyPath: process.env.AUTH_PRIVATE_KEY_PATH || "./keys/auth_private.pem",
    authPrivateKeyPassphrase: process.env.AUTH_PRIVATE_KEY_PASSPHRASE || "",
    webserverSignPublicKeyPath:
      process.env.WEBSERVER_SIGN_PUBLIC_KEY_PATH || "./keys/webserver_sign_public.pem",
    defaultShell:
      process.env.DEFAULT_SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/bash"),
    maxTerminalSessions: toNumber(process.env.MAX_TERMINAL_SESSIONS, 4),
    sessionIdleTimeoutMs: toNumber(process.env.SESSION_IDLE_TIMEOUT_MS, 30 * 60 * 1000),
    sessionOutputLimit: toNumber(process.env.SESSION_OUTPUT_LIMIT, 200),
    taskProfileConfigPath:
      process.env.TASK_PROFILE_CONFIG_PATH || "./config/tool-profiles.json",
    allowedCwdRoots: toList(process.env.ALLOWED_CWD_ROOTS),
    localDebugServerEnabled: toBoolean(process.env.LOCAL_DEBUG_SERVER_ENABLED, false),
    localDebugServerHost: process.env.LOCAL_DEBUG_SERVER_HOST || "127.0.0.1",
    localDebugServerPort: toNumber(process.env.LOCAL_DEBUG_SERVER_PORT, 3210),
    localDebugToken: process.env.LOCAL_DEBUG_TOKEN || ""
  };
}
