import { EventEmitter } from "node:events";

export class RuntimeStateStore extends EventEmitter {
  constructor() {
    super();
    this.snapshot = createDefaultSnapshot();
  }

  getSnapshot() {
    return cloneValue(this.snapshot);
  }

  replace(snapshot) {
    this.snapshot = mergeDeep(createDefaultSnapshot(), snapshot || {});
    this.emitChange();
  }

  patch(partial) {
    this.snapshot = mergeDeep(this.snapshot, partial || {});
    this.emitChange();
  }

  subscribe(listener) {
    this.on("changed", listener);

    return () => {
      this.off("changed", listener);
    };
  }

  emitChange() {
    this.emit("changed", this.getSnapshot());
  }
}

export function createDefaultSnapshot() {
  return {
    app: {
      started: false,
      startedAt: null,
      stoppedAt: null
    },
    connection: {
      status: "offline",
      serverWsUrl: "",
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: ""
    },
    agent: {
      agentId: "",
      agentLabel: "",
      hostname: "",
      pid: null
    },
    security: {
      keysReady: false,
      authPrivateKeyPath: "",
      authPublicFingerprint: "",
      webserverSignFingerprint: "",
      authPublicKeyPath: "",
      webserverSignPublicKeyPath: ""
    },
    commands: {
      processing: false,
      queueLength: 0,
      bufferedMessages: 0
    },
    terminal: {
      maxSessions: 0,
      activeSessionCount: 0,
      remoteSessionCount: 0,
      localDebugSessionCount: 0,
      availableProfileCount: 0,
      profiles: [],
      sessions: []
    },
    debugServer: {
      enabled: false,
      host: "",
      port: null,
      listening: false
    },
    meta: {
      logDir: "",
      configPath: "",
      keyDir: "",
      profileConfigPath: ""
    }
  };
}

function mergeDeep(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return cloneValue(source);
  }

  const next = {
    ...target
  };

  for (const [key, value] of Object.entries(source)) {
    const existing = next[key];

    if (isPlainObject(existing) && isPlainObject(value)) {
      next[key] = mergeDeep(existing, value);
      continue;
    }

    next[key] = cloneValue(value);
  }

  return next;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
