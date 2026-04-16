import dotenv from "dotenv";

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  return {
    httpPort: toNumber(process.env.HTTP_PORT, 3100),
    agentSharedToken: process.env.AGENT_SHARED_TOKEN || "",
    commandHistoryLimit: toNumber(process.env.COMMAND_HISTORY_LIMIT, 100),
    logLevel: process.env.LOG_LEVEL || "info",
    logDir: process.env.LOG_DIR || "logs",
    mysqlUrl: process.env.MYSQL_URL || "mysql://root:atan135@127.0.0.1:3306/remote_client",
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "remote_client_session",
    sessionTtlHours: toNumber(process.env.SESSION_TTL_HOURS, 24),
    sessionSecure: process.env.SESSION_SECURE === "true",
    allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION !== "false"
  };
}
