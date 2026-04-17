import os from "node:os";
import process from "node:process";

import { AgentClient } from "./synced/agent-client.js";
import { configureLogging, logEvent } from "./logger.js";

export class Localapp2Runtime {
  constructor({ configStore, keyManager, stateStore }) {
    this.configStore = configStore;
    this.keyManager = keyManager;
    this.stateStore = stateStore;
    this.client = null;
    this.config = null;
    this.loggers = null;
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
    this.client = new AgentClient(this.config, this.loggers);
    this.instrumentClient();
    this.stateStore.replace(createBaseSnapshot(this.config, this.loggers.logDir));

    logEvent(this.loggers.agentLogger, "info", "agent2.boot", {
      agentId: this.config.agentId,
      serverWsUrl: this.config.serverWsUrl,
      logDir: this.loggers.logDir,
      authPrivateKeyPath: this.config.authPrivateKeyPath,
      webserverSignPublicKeyPath: this.config.webserverSignPublicKeyPath
    });

    this.client.start();
    this.startPolling();
    await this.refreshSecurityState();
    return this.getSnapshot();
  }

  async stop() {
    this.stopping = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
    meta: {
      logDir
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
