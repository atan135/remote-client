import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export class ConfigStore {
  constructor({ userDataDir, env = process.env } = {}) {
    if (!userDataDir) {
      throw new Error("ConfigStore requires a userDataDir");
    }

    this.userDataDir = userDataDir;
    this.env = env;
  }

  getPaths() {
    return {
      userDataDir: this.userDataDir,
      configPath: path.join(this.userDataDir, "config.json"),
      keysDir: path.join(this.userDataDir, "keys"),
      logsDir: path.join(this.userDataDir, "logs"),
      appDataDir: path.join(this.userDataDir, "appdata"),
      bundledProfileConfigPath: path.join(packageRoot, "config", "tool-profiles.json")
    };
  }

  async ensureBaseDirectories() {
    const paths = this.getPaths();
    await fs.mkdir(paths.userDataDir, { recursive: true });
    await fs.mkdir(paths.keysDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.mkdir(paths.appDataDir, { recursive: true });
    await seedFileIfMissing(paths.bundledProfileConfigPath, path.join(paths.appDataDir, "tool-profiles.json"));
  }

  getDefaultConfig() {
    const hostname = os.hostname();
    const paths = this.getPaths();

    return this.normalizeConfig({
      envFilePath: paths.configPath,
      serverWsUrl: this.env.SERVER_WS_URL || "ws://localhost:3100/ws/agent",
      agentId: this.env.AGENT_ID || `${hostname}-desktop`,
      agentLabel: this.env.AGENT_LABEL || `${hostname} Desktop`,
      agentSharedToken: this.env.AGENT_SHARED_TOKEN || "",
      heartbeatIntervalMs: this.env.HEARTBEAT_INTERVAL_MS,
      reconnectIntervalMs: this.env.RECONNECT_INTERVAL_MS,
      commandTimeoutMs: this.env.COMMAND_TIMEOUT_MS,
      maxBufferBytes: this.env.MAX_BUFFER_BYTES,
      logLevel: this.env.LOG_LEVEL || "info",
      logDir: this.env.LOG_DIR || paths.logsDir,
      windowsOutputEncoding: this.env.WINDOWS_OUTPUT_ENCODING || "cp936",
      authPrivateKeyPath:
        this.env.AUTH_PRIVATE_KEY_PATH || path.join(paths.keysDir, "auth_private.pem"),
      authPublicKeyPath:
        this.env.AUTH_PUBLIC_KEY_PATH || path.join(paths.keysDir, "auth_public.pem"),
      authPrivateKeyPassphrase: this.env.AUTH_PRIVATE_KEY_PASSPHRASE || "",
      webserverSignPublicKeyPath:
        this.env.WEBSERVER_SIGN_PUBLIC_KEY_PATH ||
        path.join(paths.keysDir, "webserver_sign_public.pem"),
      defaultShell:
        this.env.DEFAULT_SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash"),
      windowsUseConpty: this.env.WINDOWS_USE_CONPTY,
      windowsUseConptyDll: this.env.WINDOWS_USE_CONPTY_DLL,
      remoteFileMaxBytes: this.env.REMOTE_FILE_MAX_BYTES,
      maxTerminalSessions: this.env.MAX_TERMINAL_SESSIONS,
      sessionIdleTimeoutMs: this.env.SESSION_IDLE_TIMEOUT_MS,
      sessionOutputLimit: this.env.SESSION_OUTPUT_LIMIT,
      taskProfileConfigPath:
        this.env.TASK_PROFILE_CONFIG_PATH || path.join(paths.appDataDir, "tool-profiles.json"),
      discoveredTerminalCommands: this.env.DISCOVER_TERMINAL_COMMANDS,
      commonWorkingDirectories: this.env.COMMON_WORK_DIRS,
      presetCommands: this.env.PRESET_COMMANDS,
      allowedCwdRoots: this.env.ALLOWED_CWD_ROOTS,
      localDebugServerEnabled: this.env.LOCAL_DEBUG_SERVER_ENABLED,
      localDebugServerHost: this.env.LOCAL_DEBUG_SERVER_HOST,
      localDebugServerPort: this.env.LOCAL_DEBUG_SERVER_PORT,
      localDebugToken: this.env.LOCAL_DEBUG_TOKEN,
      closeToTray: this.env.CLOSE_TO_TRAY ?? this.env.MINIMIZE_TO_TRAY,
      launchOnStartup: this.env.LAUNCH_ON_STARTUP
    });
  }

  async load() {
    await this.ensureBaseDirectories();

    const defaults = this.getDefaultConfig();
    const { configPath } = this.getPaths();

    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const merged = this.normalizeConfig({
        ...defaults,
        ...parsed
      });
      await this.save(merged);
      return merged;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`读取 localapp2 配置失败: ${error.message}`);
      }

      await this.save(defaults);
      return defaults;
    }
  }

  async update(patch) {
    const current = await this.load();
    const next = this.normalizeConfig({
      ...current,
      ...patch
    });
    await this.save(next);
    return next;
  }

  async save(config) {
    const { configPath } = this.getPaths();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  }

  normalizeConfig(input = {}) {
    const paths = this.getPaths();
    const defaults = {
      envFilePath: paths.configPath,
      serverWsUrl: "ws://localhost:3100/ws/agent",
      agentId: `${os.hostname()}-desktop`,
      agentLabel: `${os.hostname()} Desktop`,
      agentSharedToken: "",
      heartbeatIntervalMs: 15000,
      reconnectIntervalMs: 5000,
      commandTimeoutMs: 120000,
      maxBufferBytes: 1024 * 1024,
      logLevel: "info",
      logDir: paths.logsDir,
      windowsOutputEncoding: "cp936",
      authPrivateKeyPath: path.join(paths.keysDir, "auth_private.pem"),
      authPublicKeyPath: path.join(paths.keysDir, "auth_public.pem"),
      authPrivateKeyPassphrase: "",
      webserverSignPublicKeyPath: path.join(paths.keysDir, "webserver_sign_public.pem"),
      defaultShell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
      windowsUseConpty: undefined,
      windowsUseConptyDll: undefined,
      remoteFileMaxBytes: 1024 * 1024,
      maxTerminalSessions: 4,
      sessionIdleTimeoutMs: 30 * 60 * 1000,
      sessionOutputLimit: 1200,
      taskProfileConfigPath: path.join(paths.appDataDir, "tool-profiles.json"),
      discoveredTerminalCommands: [],
      commonWorkingDirectories: [],
      presetCommands: [],
      allowedCwdRoots: [],
      localDebugServerEnabled: false,
      localDebugServerHost: "127.0.0.1",
      localDebugServerPort: 3210,
      localDebugToken: "",
      webserverSignPublicKeyEnvVarName: "WEBSERVER_SIGN_PUBLIC_KEY_PATH",
      authPrivateKeyPathSource: "config_store",
      authPrivateKeyConfiguredInEnvFile: true,
      webserverSignPublicKeyPathSource: "config_store",
      webserverSignPublicKeyConfiguredInEnvFile: true,
      closeToTray: true,
      launchOnStartup: false
    };

    return {
      envFilePath: toAbsolutePath(input.envFilePath, defaults.envFilePath, this.userDataDir),
      envFileLoaded: true,
      serverWsUrl: toText(input.serverWsUrl, defaults.serverWsUrl),
      agentId: toText(input.agentId, defaults.agentId),
      agentLabel: toText(input.agentLabel, defaults.agentLabel),
      agentSharedToken: String(input.agentSharedToken || ""),
      heartbeatIntervalMs: toNumber(input.heartbeatIntervalMs, defaults.heartbeatIntervalMs),
      reconnectIntervalMs: toNumber(input.reconnectIntervalMs, defaults.reconnectIntervalMs),
      commandTimeoutMs: toNumber(input.commandTimeoutMs, defaults.commandTimeoutMs),
      maxBufferBytes: toNumber(input.maxBufferBytes, defaults.maxBufferBytes),
      logLevel: toText(input.logLevel, defaults.logLevel),
      logDir: toAbsolutePath(input.logDir, defaults.logDir, this.userDataDir),
      windowsOutputEncoding: toText(
        input.windowsOutputEncoding,
        defaults.windowsOutputEncoding
      ),
      authPrivateKeyPath: toAbsolutePath(
        input.authPrivateKeyPath,
        defaults.authPrivateKeyPath,
        this.userDataDir
      ),
      authPublicKeyPath: toAbsolutePath(
        input.authPublicKeyPath,
        defaults.authPublicKeyPath,
        this.userDataDir
      ),
      authPrivateKeyPassphrase: String(input.authPrivateKeyPassphrase || ""),
      webserverSignPublicKeyPath: toAbsolutePath(
        input.webserverSignPublicKeyPath,
        defaults.webserverSignPublicKeyPath,
        this.userDataDir
      ),
      defaultShell: toText(input.defaultShell, defaults.defaultShell),
      windowsUseConpty: toOptionalBoolean(input.windowsUseConpty),
      windowsUseConptyDll: toOptionalBoolean(input.windowsUseConptyDll),
      remoteFileMaxBytes: toNumber(input.remoteFileMaxBytes, defaults.remoteFileMaxBytes),
      maxTerminalSessions: toNumber(input.maxTerminalSessions, defaults.maxTerminalSessions),
      sessionIdleTimeoutMs: toNumber(
        input.sessionIdleTimeoutMs,
        defaults.sessionIdleTimeoutMs
      ),
      sessionOutputLimit: toNumber(input.sessionOutputLimit, defaults.sessionOutputLimit),
      taskProfileConfigPath: toAbsolutePath(
        input.taskProfileConfigPath,
        defaults.taskProfileConfigPath,
        this.userDataDir
      ),
      discoveredTerminalCommands: toUniqueList(input.discoveredTerminalCommands),
      commonWorkingDirectories: toUniqueList(input.commonWorkingDirectories),
      presetCommands: toPresetCommands(input.presetCommands),
      allowedCwdRoots: toList(input.allowedCwdRoots),
      localDebugServerEnabled: toBoolean(
        input.localDebugServerEnabled,
        defaults.localDebugServerEnabled
      ),
      localDebugServerHost: toText(
        input.localDebugServerHost,
        defaults.localDebugServerHost
      ),
      localDebugServerPort: toNumber(
        input.localDebugServerPort,
        defaults.localDebugServerPort
      ),
      localDebugToken: String(input.localDebugToken || ""),
      webserverSignPublicKeyEnvVarName: "WEBSERVER_SIGN_PUBLIC_KEY_PATH",
      authPrivateKeyPathSource: "config_store",
      authPrivateKeyConfiguredInEnvFile: true,
      webserverSignPublicKeyPathSource: "config_store",
      webserverSignPublicKeyConfiguredInEnvFile: true,
      closeToTray: toBoolean(
        input.closeToTray ?? input.minimizeToTray,
        defaults.closeToTray
      ),
      launchOnStartup: toBoolean(input.launchOnStartup, defaults.launchOnStartup)
    };
  }
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return toBoolean(value, false);
}

function toText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toAbsolutePath(value, fallback, baseDir) {
  const raw = String(value || "").trim();
  const target = raw || fallback;
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toUniqueList(value) {
  return Array.from(new Set(toList(value)));
}

function toPresetCommands(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePresetCommand(item))
      .filter(Boolean);
  }

  const seen = new Set();
  const presets = [];

  for (const rawEntry of String(value || "").split(/\r?\n|\|\|/)) {
    const preset = normalizePresetCommand(rawEntry);

    if (!preset) {
      continue;
    }

    const dedupeKey = `${preset.label}\u0000${preset.command}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    presets.push(preset);
  }

  return presets;
}

function normalizePresetCommand(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const label = String(value.label || value.command || "").trim();
    const command = String(value.command || "").trim();

    if (!label || !command) {
      return null;
    }

    return {
      label,
      command
    };
  }

  const entry = String(value || "").trim();

  if (!entry) {
    return null;
  }

  const separatorIndex = entry.indexOf("::");
  const label = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : "";
  const command = separatorIndex >= 0 ? entry.slice(separatorIndex + 2).trim() : entry;

  if (!command) {
    return null;
  }

  return {
    label: label || command,
    command
  };
}

async function seedFileIfMissing(sourcePath, targetPath) {
  try {
    await fs.access(targetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    try {
      const bundled = await fs.readFile(sourcePath, "utf8");
      await fs.writeFile(targetPath, bundled, "utf8");
    } catch (readError) {
      if (readError.code !== "ENOENT") {
        throw readError;
      }
    }
  }
}
