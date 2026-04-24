import os from "node:os";
import path from "node:path";
import process from "node:process";

import { ExecutionGateway } from "./synced/runtime/execution-gateway.js";
import { PtySessionManager } from "./synced/runtime/pty-session-manager.js";
import { SessionStore } from "./synced/runtime/session-store.js";
import { ToolProfileRegistry } from "./synced/runtime/tool-profile-registry.js";
import { AgentClient } from "./synced/agent-client.js";
import { LocalDebugServer } from "./synced/local-debug-server.js";
import { configureLogging, logEvent } from "./logger.js";

export class Localapp2Runtime {
  constructor({ configStore, keyManager, stateStore }) {
    this.configStore = configStore;
    this.keyManager = keyManager;
    this.stateStore = stateStore;
    this.client = null;
    this.config = null;
    this.loggers = null;
    this.profileRegistry = null;
    this.sessionStore = null;
    this.ptySessionManager = null;
    this.executionGateway = null;
    this.localDebugServer = null;
    this.pollTimer = null;
    this.stopping = false;
    this.lastSecurityRefreshMs = 0;
  }

  async start() {
    if (this.client) {
      return this.getSnapshot();
    }

    this.config = await this.configStore.load();
    this.loggers = configureLogging(this.config);
    this.profileRegistry = new ToolProfileRegistry(this.config);
    this.sessionStore = new SessionStore(
      this.config.maxTerminalSessions * 4,
      this.config.sessionOutputLimit
    );
    this.ptySessionManager = new PtySessionManager(
      this.config,
      this.loggers,
      this.profileRegistry,
      this.sessionStore
    );
    this.executionGateway = new ExecutionGateway(this.config, this.ptySessionManager);
    this.client = new AgentClient(
      this.config,
      this.loggers,
      this.executionGateway,
      this.profileRegistry
    );
    this.localDebugServer = new LocalDebugServer(
      this.config,
      this.loggers,
      this.executionGateway,
      this.profileRegistry
    );
    this.instrumentClient();
    this.stateStore.replace(createBaseSnapshot(this.config, this.loggers.logDir));

    logEvent(this.loggers.agentLogger, "info", "agent2.boot", {
      agentId: this.config.agentId,
      serverWsUrl: this.config.serverWsUrl,
      envFilePath: this.config.envFilePath,
      logDir: this.loggers.logDir,
      presetCommandCount: Array.isArray(this.config.presetCommands)
        ? this.config.presetCommands.length
        : 0,
      authPrivateKeyPath: this.config.authPrivateKeyPath,
      webserverSignPublicKeyPath: this.config.webserverSignPublicKeyPath,
      defaultShell: this.config.defaultShell,
      windowsUseConpty: this.config.windowsUseConpty,
      windowsUseConptyDll: this.config.windowsUseConptyDll,
      localDebugServerEnabled: this.config.localDebugServerEnabled
    });

    try {
      const securityKeyMaterial = this.client.inspectSecurityKeyMaterial();
      logEvent(this.loggers.agentLogger, "info", "security.local_key_ready", securityKeyMaterial);
    } catch (error) {
      logEvent(this.loggers.agentLogger, "warn", "security.local_key_invalid", {
        errorCode: error?.code || "",
        error: error instanceof Error ? error.message : String(error),
        ...(error?.details && typeof error.details === "object" ? error.details : {})
      });
    }

    try {
      this.client.start();
      this.localDebugServer.start();
      this.startPolling();
      await this.refreshSecurityState();
      this.refreshSnapshot();
      return this.getSnapshot();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.stopping = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await closeServer(this.localDebugServer?.server);

    if (this.ptySessionManager) {
      this.ptySessionManager.terminateBySource("remote", "runtime_stop");
      this.ptySessionManager.terminateBySource("local-debug", "runtime_stop");
    }

    if (this.client) {
      this.client.scheduleReconnect = () => {};
      this.client.flushReconnectTimer?.();
      this.client.stopHeartbeat?.();

      if (this.client.socket) {
        this.client.socket.removeAllListeners();
        this.client.socket.close();
      }
    }

    this.client = null;
    this.loggers = null;
    this.config = null;
    this.profileRegistry = null;
    this.sessionStore = null;
    this.ptySessionManager = null;
    this.executionGateway = null;
    this.localDebugServer = null;
    this.lastSecurityRefreshMs = 0;

    this.stateStore.patch({
      app: {
        started: false,
        stoppedAt: new Date().toISOString()
      },
      connection: {
        status: "offline"
      },
      commands: {
        processing: false,
        queueLength: 0,
        bufferedMessages: 0
      },
      terminal: {
        activeSessionCount: 0,
        remoteSessionCount: 0,
        localDebugSessionCount: 0,
        sessions: []
      },
      debugServer: {
        listening: false
      }
    });

    this.stopping = false;
    return this.getSnapshot();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  getSnapshot() {
    return this.stateStore.getSnapshot();
  }

  async refreshSecurityState() {
    if (!this.config) {
      return;
    }

    const summary = await this.keyManager.getSummary(this.config);
    this.stateStore.patch({
      security: {
        keysReady: summary.keysReady,
        authPrivateKeyPath: summary.authPrivateKeyPath,
        authPublicFingerprint: summary.authPublicFingerprint,
        webserverSignFingerprint: summary.webserverSignFingerprint,
        authPublicKeyPath: summary.authPublicKeyPath,
        webserverSignPublicKeyPath: summary.webserverSignPublicKeyPath
      }
    });
  }

  instrumentClient() {
    const originalConnect = this.client.connect.bind(this.client);

    this.client.connect = () => {
      this.stateStore.patch({
        connection: {
          status: this.client.reconnectTimer ? "reconnecting" : "connecting",
          serverWsUrl: this.config.serverWsUrl
        }
      });

      originalConnect();
      this.attachSocketListeners(this.client.socket);
    };
  }

  attachSocketListeners(socket) {
    if (!socket || socket.__localapp2Bound) {
      return;
    }

    socket.__localapp2Bound = true;

    socket.on("open", () => {
      this.stateStore.patch({
        connection: {
          status: "online",
          lastConnectedAt: new Date().toISOString(),
          lastError: ""
        }
      });
    });

    socket.on("close", () => {
      if (this.stopping) {
        return;
      }

      this.stateStore.patch({
        connection: {
          status: "offline",
          lastDisconnectedAt: new Date().toISOString()
        }
      });
    });

    socket.on("error", (error) => {
      this.stateStore.patch({
        connection: {
          status: "error",
          lastError: error.message
        }
      });
    });
  }

  startPolling() {
    this.refreshSnapshot();
    this.pollTimer = setInterval(() => {
      this.refreshSnapshot();
    }, 1000);
  }

  refreshSnapshot() {
    if (!this.client || !this.config) {
      return;
    }

    const now = Date.now();
    const sessions = summarizeTerminalSessions(this.sessionStore?.list() || []);
    const profiles = summarizeTerminalProfiles(this.profileRegistry?.listProfiles?.() || []);

    this.stateStore.patch({
      app: {
        started: true
      },
      connection: {
        status: inferConnectionStatus(this.client),
        serverWsUrl: this.config.serverWsUrl
      },
      agent: {
        agentId: this.config.agentId,
        agentLabel: this.config.agentLabel,
        hostname: os.hostname(),
        pid: process.pid
      },
      commands: {
        processing: Boolean(this.client.processing),
        queueLength: this.client.commandQueue.length,
        bufferedMessages: this.client.outbox.length
      },
      terminal: {
        maxSessions: this.config.maxTerminalSessions,
        activeSessionCount: sessions.filter((session) => !isClosedSessionStatus(session.status)).length,
        remoteSessionCount: sessions.filter(
          (session) => session.source === "remote" && !isClosedSessionStatus(session.status)
        ).length,
        localDebugSessionCount: sessions.filter(
          (session) =>
            session.source === "local-debug" && !isClosedSessionStatus(session.status)
        ).length,
        availableProfileCount: profiles.filter((profile) => profile.isAvailable !== false).length,
        profiles,
        sessions
      },
      debugServer: {
        enabled: Boolean(this.config.localDebugServerEnabled),
        host: this.config.localDebugServerHost,
        port: this.config.localDebugServerPort,
        listening: Boolean(this.localDebugServer?.server?.listening)
      },
      meta: {
        logDir: this.loggers?.logDir || "",
        configPath: this.config.envFilePath || "",
        keyDir: path.dirname(this.config.authPrivateKeyPath),
        profileConfigPath: this.config.taskProfileConfigPath || ""
      }
    });

    if (now - this.lastSecurityRefreshMs > 5000) {
      this.lastSecurityRefreshMs = now;
      void this.refreshSecurityState();
    }
  }
}

function createBaseSnapshot(config, logDir) {
  return {
    app: {
      started: true,
      startedAt: new Date().toISOString(),
      stoppedAt: null
    },
    connection: {
      status: "connecting",
      serverWsUrl: config.serverWsUrl,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: ""
    },
    agent: {
      agentId: config.agentId,
      agentLabel: config.agentLabel,
      hostname: os.hostname(),
      pid: process.pid
    },
    security: {
      keysReady: false,
      authPrivateKeyPath: config.authPrivateKeyPath,
      authPublicFingerprint: "",
      webserverSignFingerprint: "",
      authPublicKeyPath: config.authPublicKeyPath,
      webserverSignPublicKeyPath: config.webserverSignPublicKeyPath
    },
    commands: {
      processing: false,
      queueLength: 0,
      bufferedMessages: 0
    },
    terminal: {
      maxSessions: config.maxTerminalSessions,
      activeSessionCount: 0,
      remoteSessionCount: 0,
      localDebugSessionCount: 0,
      availableProfileCount: 0,
      profiles: [],
      sessions: []
    },
    debugServer: {
      enabled: Boolean(config.localDebugServerEnabled),
      host: config.localDebugServerHost,
      port: config.localDebugServerPort,
      listening: false
    },
    meta: {
      logDir,
      configPath: config.envFilePath || "",
      keyDir: path.dirname(config.authPrivateKeyPath),
      profileConfigPath: config.taskProfileConfigPath || ""
    }
  };
}

function inferConnectionStatus(client) {
  if (client.socket?.readyState === 1) {
    return "online";
  }

  if (client.socket?.readyState === 0) {
    return "connecting";
  }

  if (client.reconnectTimer) {
    return "reconnecting";
  }

  return "offline";
}

function summarizeTerminalProfiles(profiles) {
  return profiles
    .filter((profile) => profile?.runner === "pty")
    .map((profile) => ({
      name: String(profile.name || ""),
      label: String(profile.label || profile.name || ""),
      command: String(profile.command || ""),
      source: String(profile.source || ""),
      kind: String(profile.kind || ""),
      description: String(profile.description || ""),
      recommended: profile.recommended === true,
      isAvailable: profile.isAvailable !== false,
      unavailableReason: String(profile.unavailableReason || "")
    }));
}

function summarizeTerminalSessions(sessions) {
  return sessions.map((session) => ({
    sessionId: String(session?.sessionId || ""),
    requestId: String(session?.requestId || ""),
    source: String(session?.source || ""),
    profile: String(session?.profile || ""),
    profileLabel: String(session?.profileLabel || session?.profile || ""),
    status: String(session?.status || ""),
    cwd: String(session?.cwd || ""),
    pid: typeof session?.pid === "number" ? session.pid : null,
    cols: typeof session?.cols === "number" ? session.cols : null,
    rows: typeof session?.rows === "number" ? session.rows : null,
    createdAt: session?.createdAt || null,
    startedAt: session?.startedAt || null,
    lastInputAt: session?.lastInputAt || null,
    lastOutputAt: session?.lastOutputAt || null,
    closedAt: session?.closedAt || null,
    updatedAt: session?.updatedAt || null,
    error: String(session?.error || "")
  }));
}

function isClosedSessionStatus(status) {
  return ["completed", "failed", "terminated"].includes(String(status || ""));
}

function closeServer(server) {
  if (!server?.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
