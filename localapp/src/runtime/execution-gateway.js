import { runCommand } from "../command-runner.js";
import { readTextFilePreview } from "../file-reader.js";

export class ExecutionGateway {
  constructor(config, ptySessionManager) {
    this.config = config;
    this.ptySessionManager = ptySessionManager;
  }

  executeCommand(command) {
    return runCommand(command, this.config);
  }

  async readTextFile(filePath, options = {}) {
    const baseCwd = await this.resolveRemoteFileBaseCwd(options.sessionId, filePath);

    return readTextFilePreview(filePath, {
      baseCwd,
      maxBytes: this.config.remoteFileMaxBytes,
      windowsEncoding: this.config.windowsOutputEncoding
    });
  }

  async resolveRemoteFileBaseCwd(sessionId, filePath) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedFilePath = String(filePath || "").trim();

    if (!normalizedSessionId || !normalizedFilePath) {
      return "";
    }

    return this.ptySessionManager.querySessionCwd(normalizedSessionId, normalizedFilePath);
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
