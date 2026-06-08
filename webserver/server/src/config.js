import dotenv from "dotenv";

dotenv.config();

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  return {
    httpPort: toNumber(process.env.HTTP_PORT, 3100),
    agentSharedToken: process.env.AGENT_SHARED_TOKEN || "",
    commandHistoryLimit: toNumber(process.env.COMMAND_HISTORY_LIMIT, 100),
    terminalSessionHistoryLimit: toNumber(process.env.TERMINAL_SESSION_HISTORY_LIMIT, 100),
    terminalSessionOutputLimit: toNumber(process.env.TERMINAL_SESSION_OUTPUT_LIMIT, 200),
    terminalSessionPersistDebounceMs: toNumber(
      process.env.TERMINAL_SESSION_PERSIST_DEBOUNCE_MS,
      500
    ),
    terminalSessionTurnSyncDebounceMs: toNumber(
      process.env.TERMINAL_SESSION_TURN_SYNC_DEBOUNCE_MS,
      1000
    ),
    agentDisconnectGraceMs: toNumber(process.env.AGENT_DISCONNECT_GRACE_MS, 8000),
    agentHeartbeatBroadcastIntervalMs: toNumber(
      process.env.AGENT_HEARTBEAT_BROADCAST_INTERVAL_MS,
      30000
    ),
    secureCommandTtlMs: toNumber(process.env.SECURE_COMMAND_TTL_MS, 60000),
    logLevel: process.env.LOG_LEVEL || "info",
    logDir: process.env.LOG_DIR || "logs",
    mysqlUrl: process.env.MYSQL_URL || "mysql://root:atan135@127.0.0.1:3306/remote_client",
    canJietu: toBoolean(process.env.CAN_JIETU, false),
    jietuWebBaseUrl: process.env.JIETU_WEB_BASE_URL || "",
    jietuOutputDir: process.env.JIETU_OUTPUT_DIR || "../output/image",
    jietuDefaultWidth: toNumber(process.env.JIETU_DEFAULT_WIDTH, 1440),
    jietuDefaultHeight: toNumber(process.env.JIETU_DEFAULT_HEIGHT, 1000),
    jietuMaxWaitMs: toNumber(process.env.JIETU_MAX_WAIT_MS, 12000),
    jietuSettleMs: toNumber(process.env.JIETU_SETTLE_MS, 500),
    jietuMaxConcurrent: toNumber(process.env.JIETU_MAX_CONCURRENT, 1),
    jietuBrowserExecutablePath: process.env.JIETU_BROWSER_EXECUTABLE_PATH || "",
    jietuBrowserChannel: process.env.JIETU_BROWSER_CHANNEL || "",
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "remote_client_session",
    sessionTtlHours: toNumber(process.env.SESSION_TTL_HOURS, 24),
    sessionSecure: process.env.SESSION_SECURE === "true",
    allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION !== "false",
    registrationApprovalRequired: process.env.REGISTRATION_APPROVAL_REQUIRED === "true",
    agentApprovalRequired: process.env.AGENT_APPROVAL_REQUIRED === "true",
    webserverSignPrivateKeyPath:
      process.env.WEBSERVER_SIGN_PRIVATE_KEY_PATH || "./keys/webserver_sign_private.pem",
    webserverSignPrivateKeyPassphrase: process.env.WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE || "",
    webserverSignPublicKeyPath:
      process.env.WEBSERVER_SIGN_PUBLIC_KEY_PATH || "./keys/webserver_sign_public.pem"
  };
}
