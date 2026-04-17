import { logEvent } from "../logger.js";
import { TerminalSessionRunner } from "./runners/terminal-session-runner.js";

export class PtySessionManager {
  constructor(config, loggers, profileRegistry, sessionStore) {
    this.config = config;
    this.commandLogger = loggers.commandLogger;
    this.profileRegistry = profileRegistry;
    this.sessionStore = sessionStore;
    this.runner = new TerminalSessionRunner();
    this.handles = new Map();
  }

  createSession({
    sessionId,
    agentId,
    requestId,
    source,
    profileName,
    cwd,
    env = {},
    cols,
    rows,
    eventSink = null
  }) {
    if (this.handles.size >= this.config.maxTerminalSessions) {
      throw new Error(`已达到最大终端会话数: ${this.config.maxTerminalSessions}`);
    }

    const launch = this.profileRegistry.resolveSessionLaunch({
      profileName,
      cwd,
      env
    });

    this.sessionStore.create({
      sessionId,
      agentId,
      requestId,
      source,
      profile: profileName,
      sessionType: "pty",
      cwd: launch.cwd,
      envKeys: Object.keys(env || {}),
      cols,
      rows
    });

    let ptyProcess;
    try {
      ptyProcess = this.runner.spawnSession({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.env,
        cols,
        rows
      });
    } catch (error) {
      this.sessionStore.update(sessionId, {
        status: "failed",
        error: error.message,
        closedAt: new Date().toISOString()
      });
      throw error;
    }

    const handle = {
      sessionId,
      agentId,
      source,
      profileName,
      ptyProcess,
      eventSink,
      idleTimer: null,
      terminatingReason: ""
    };

    this.handles.set(sessionId, handle);
    this.armIdleTimer(handle);

    const startedAt = new Date().toISOString();
    this.sessionStore.update(sessionId, {
      status: "running",
      pid: ptyProcess.pid,
      startedAt
    });

    logEvent(this.commandLogger, "info", "terminal.session.created", {
      sessionId,
      requestId,
      agentId,
      profile: profileName,
      source,
      pid: ptyProcess.pid
    });

    this.emit(handle, "terminal.session.created", {
      sessionId,
      requestId,
      agentId,
      profile: profileName,
      status: "running",
      pid: ptyProcess.pid,
      startedAt
    }, true);

    ptyProcess.onData((chunk) => {
      this.touchSession(handle);
      const appended = this.sessionStore.appendOutput(sessionId, {
        stream: "stdout",
        chunk,
        sentAt: new Date().toISOString()
      });

      if (!appended) {
        return;
      }

      logEvent(this.commandLogger, "info", "terminal.session.output", {
        sessionId,
        agentId,
        profile: profileName,
        chunkLength: chunk.length
      });

      this.emit(handle, "terminal.session.output", {
        agentId,
        profile: profileName,
        ...appended.output
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.handleExit(handle, exitCode, signal);
    });

    return this.sessionStore.get(sessionId);
  }

  writeInput(sessionId, input) {
    const handle = this.getRequiredHandle(sessionId);
    handle.ptyProcess.write(input);
    this.touchSession(handle);
    this.sessionStore.update(sessionId, {
      lastInputAt: new Date().toISOString()
    });

    logEvent(this.commandLogger, "info", "terminal.session.input", {
      sessionId,
      agentId: handle.agentId,
      inputLength: input.length
    });

    return this.sessionStore.get(sessionId);
  }

  terminateSession(sessionId, reason = "terminated") {
    const handle = this.getRequiredHandle(sessionId);
    handle.terminatingReason = reason;
    this.sessionStore.update(sessionId, {
      status: "terminating"
    });
    handle.ptyProcess.kill();
    return this.sessionStore.get(sessionId);
  }

  terminateBySource(source, reason) {
    for (const handle of this.handles.values()) {
      if (handle.source === source) {
        handle.terminatingReason = reason;
        handle.ptyProcess.kill();
      }
    }
  }

  getSession(sessionId) {
    return this.sessionStore.get(sessionId);
  }

  listSessions() {
    return this.sessionStore.list();
  }

  getRequiredHandle(sessionId) {
    const handle = this.handles.get(sessionId);

    if (!handle) {
      throw new Error(`终端会话不存在: ${sessionId}`);
    }

    return handle;
  }

  armIdleTimer(handle) {
    this.clearIdleTimer(handle);

    handle.idleTimer = setTimeout(() => {
      handle.terminatingReason = "idle_timeout";
      handle.ptyProcess.kill();
    }, this.config.sessionIdleTimeoutMs);
  }

  clearIdleTimer(handle) {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
  }

  touchSession(handle) {
    this.armIdleTimer(handle);
  }

  handleExit(handle, exitCode, signal) {
    this.clearIdleTimer(handle);
    this.handles.delete(handle.sessionId);

    const closedAt = new Date().toISOString();
    const status = handle.terminatingReason
      ? "terminated"
      : exitCode === 0
        ? "completed"
        : "failed";
    const error =
      status === "failed" ? `Terminal session exited with code ${exitCode ?? "unknown"}.` : "";

    this.sessionStore.update(handle.sessionId, {
      status,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      error,
      closedAt
    });

    logEvent(this.commandLogger, status === "completed" ? "info" : "warn", "terminal.session.closed", {
      sessionId: handle.sessionId,
      agentId: handle.agentId,
      profile: handle.profileName,
      status,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      signal: signal || "",
      reason: handle.terminatingReason || ""
    });

    this.emit(handle, "terminal.session.closed", {
      sessionId: handle.sessionId,
      agentId: handle.agentId,
      profile: handle.profileName,
      status,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      signal: signal || "",
      reason: handle.terminatingReason || "",
      error,
      closedAt
    }, true);
  }

  emit(handle, type, payload, persistIfOffline = false) {
    if (typeof handle.eventSink !== "function") {
      return;
    }

    try {
      handle.eventSink({
        type,
        payload,
        persistIfOffline
      });
    } catch (error) {
      logEvent(this.commandLogger, "error", "terminal.session.emit_failed", {
        sessionId: handle.sessionId,
        type,
        error: error.message
      });
    }
  }
}
