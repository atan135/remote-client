import dotenv from "dotenv";
import os from "node:os";

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    windowsOutputEncoding: process.env.WINDOWS_OUTPUT_ENCODING || "cp936"
  };
}
