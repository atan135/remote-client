import dotenv from "dotenv";

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  return {
    httpPort: toNumber(process.env.HTTP_PORT, 3100),
    controlToken: process.env.CONTROL_TOKEN || "",
    agentSharedToken: process.env.AGENT_SHARED_TOKEN || "",
    commandHistoryLimit: toNumber(process.env.COMMAND_HISTORY_LIMIT, 100),
    logLevel: process.env.LOG_LEVEL || "info",
    logDir: process.env.LOG_DIR || "logs"
  };
}
