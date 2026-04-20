import { runCommand } from "../command-runner.js";

export class ExecutionGateway {
  constructor(config, ptySessionManager) {
    this.config = config;
    this.ptySessionManager = ptySessionManager;
  }

  executeCommand(command) {
    return runCommand(command, this.config);
  }

  createTerminalSession(options) {
    return this.ptySessionManager.createSession(options);
  }

  writeTerminalSessionInput(sessionId, input) {
    return this.ptySessionManager.writeInput(sessionId, input);
  }

  resizeTerminalSession(sessionId, cols, rows) {
    return this.ptySessionManager.resizeSession(sessionId, cols, rows);
  }

  terminateTerminalSession(sessionId, reason) {
    return this.ptySessionManager.terminateSession(sessionId, reason);
  }

  terminateRemoteSessions(reason) {
    return this.ptySessionManager.terminateBySource("remote", reason);
  }

  getTerminalSession(sessionId) {
    return this.ptySessionManager.getSession(sessionId);
  }

  listTerminalSessions() {
    return this.ptySessionManager.listSessions();
  }

  listActiveRemoteTerminalSessions() {
    return this.ptySessionManager.listRemoteSessions({
      activeOnly: true
    });
  }
}
