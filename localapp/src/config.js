import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const envFilePath = path.join(packageRoot, ".env");
const envLoadResult = dotenv.config({ path: envFilePath });
const parsedEnv = isPlainObject(envLoadResult.parsed) ? envLoadResult.parsed : {};

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

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return toBoolean(value, false);
}

function toList(value) {
  return String(value || "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toUniqueList(value) {
  return Array.from(new Set(toList(value)));
}

function toPresetCommands(value) {
  const seen = new Set();
  const presets = [];

  for (const rawEntry of String(value || "").split(/\r?\n|\|\|/)) {
    const entry = String(rawEntry || "").trim();

    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf("::");
    const label = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : "";
    const command = separatorIndex >= 0 ? entry.slice(separatorIndex + 2).trim() : entry;

    if (!command) {
      continue;
    }

    const normalizedLabel = label || command;
    const dedupeKey = `${normalizedLabel}\u0000${command}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    presets.push({
      label: normalizedLabel,
      command
    });
  }

  return presets;
}

export function loadConfig() {
  const hostname = os.hostname();
  const authPrivateKeyPathConfig = resolvePathConfig(
    "AUTH_PRIVATE_KEY_PATH",
    "./keys/auth_private.pem"
  );
  const webserverSignPublicKeyPathConfig = resolvePathConfig(
    "WEBSERVER_SIGN_PUBLIC_KEY_PATH",
    "./keys/webserver_sign_public.pem"
  );

  return {
    envFilePath,
    envFileLoaded: !envLoadResult.error,
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
    authPrivateKeyPath: authPrivateKeyPathConfig.value,
    authPrivateKeyPathSource: authPrivateKeyPathConfig.source,
    authPrivateKeyConfiguredInEnvFile: authPrivateKeyPathConfig.configuredInEnvFile,
    authPrivateKeyPassphrase: process.env.AUTH_PRIVATE_KEY_PASSPHRASE || "",
    webserverSignPublicKeyPath: webserverSignPublicKeyPathConfig.value,
    webserverSignPublicKeyEnvVarName: "WEBSERVER_SIGN_PUBLIC_KEY_PATH",
    webserverSignPublicKeyPathSource: webserverSignPublicKeyPathConfig.source,
    webserverSignPublicKeyConfiguredInEnvFile:
      webserverSignPublicKeyPathConfig.configuredInEnvFile,
    defaultShell:
      process.env.DEFAULT_SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/bash"),
    windowsUseConpty: toOptionalBoolean(process.env.WINDOWS_USE_CONPTY),
    windowsUseConptyDll: toOptionalBoolean(process.env.WINDOWS_USE_CONPTY_DLL),
    remoteFileMaxBytes: toNumber(process.env.REMOTE_FILE_MAX_BYTES, 1024 * 1024),
    maxTerminalSessions: toNumber(process.env.MAX_TERMINAL_SESSIONS, 4),
    sessionIdleTimeoutMs: toNumber(process.env.SESSION_IDLE_TIMEOUT_MS, 30 * 60 * 1000),
    sessionOutputLimit: toNumber(process.env.SESSION_OUTPUT_LIMIT, 1200),
    taskProfileConfigPath:
      process.env.TASK_PROFILE_CONFIG_PATH || "./config/tool-profiles.json",
    discoveredTerminalCommands: toUniqueList(process.env.DISCOVER_TERMINAL_COMMANDS),
    commonWorkingDirectories: toUniqueList(process.env.COMMON_WORK_DIRS),
    presetCommands: toPresetCommands(process.env.PRESET_COMMANDS),
    allowedCwdRoots: toList(process.env.ALLOWED_CWD_ROOTS),
    localDebugServerEnabled: toBoolean(process.env.LOCAL_DEBUG_SERVER_ENABLED, false),
    localDebugServerHost: process.env.LOCAL_DEBUG_SERVER_HOST || "127.0.0.1",
    localDebugServerPort: toNumber(process.env.LOCAL_DEBUG_SERVER_PORT, 3210),
    localDebugToken: process.env.LOCAL_DEBUG_TOKEN || ""
  };
}

function resolvePathConfig(envVarName, fallback) {
  const runtimeValue = String(process.env[envVarName] || "").trim();
  const envFileValue = String(parsedEnv[envVarName] || "").trim();
  const normalizedValue = runtimeValue || fallback;

  return {
    value: normalizedValue,
    source: envFileValue
      ? "localapp_env"
      : runtimeValue
        ? "process_env"
        : "default",
    configuredInEnvFile: Boolean(envFileValue)
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
