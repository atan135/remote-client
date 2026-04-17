import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
      logsDir: path.join(this.userDataDir, "logs")
    };
  }

  async ensureBaseDirectories() {
    const paths = this.getPaths();
    await fs.mkdir(paths.userDataDir, { recursive: true });
    await fs.mkdir(paths.keysDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
  }

  getDefaultConfig() {
    const hostname = os.hostname();
    const paths = this.getPaths();

    return this.normalizeConfig({
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
      minimizeToTray: this.env.MINIMIZE_TO_TRAY,
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
      minimizeToTray: true,
      launchOnStartup: false
    };

    return {
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
      minimizeToTray: toBoolean(input.minimizeToTray, defaults.minimizeToTray),
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

function toText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toAbsolutePath(value, fallback, baseDir) {
  const raw = String(value || "").trim();
  const target = raw || fallback;
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}
