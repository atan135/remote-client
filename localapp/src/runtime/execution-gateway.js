import { runCommand } from "../command-runner.js";
import { readTextFilePreview, writeTextFile as writeTextFileContent } from "../file-reader.js";

export class ExecutionGateway {
  constructor(config, ptySessionManager) {
    this.config = config;
    this.ptySessionManager = ptySessionManager;
  }

  executeCommand(command, options = {}) {
    return runCommand(command, this.config, options);
  }

  async readTextFile(filePath, options = {}) {
    const requestedPath = String(filePath || "").trim();
    const sessionId = String(options.sessionId || "").trim();
    let baseCwd = String(options.baseCwd || "").trim();
    let baseCwdSource = baseCwd ? "request" : "";

    if (sessionId) {
      try {
        const liveCwd = await this.ptySessionManager.querySessionCwd(sessionId, requestedPath);

        if (liveCwd) {
          baseCwd = liveCwd;
          baseCwdSource = "terminal.current.cwd";
        }
      } catch (error) {
        if (!baseCwd) {
          throw error;
        }
      }
    }

    return readTextFilePreview(filePath, {
      baseCwd,
      baseCwdSource,
      maxBytes: this.config.remoteFileMaxBytes,
      windowsEncoding: this.config.windowsOutputEncoding
    });
  }

  async writeTextFile(filePath, options = {}) {
    const requestedPath = String(filePath || "").trim();
    const sessionId = String(options.sessionId || "").trim();
    let baseCwd = String(options.baseCwd || "").trim();
    let baseCwdSource = baseCwd ? "request" : "";

    if (sessionId) {
      try {
        const liveCwd = await this.ptySessionManager.querySessionCwd(sessionId, requestedPath);

        if (liveCwd) {
          baseCwd = liveCwd;
          baseCwdSource = "terminal.current.cwd";
        }
      } catch (error) {
        if (!baseCwd) {
          throw error;
        }
      }
    }

    return writeTextFileContent(filePath, {
      baseCwd,
      baseCwdSource,
      content: options.content,
      encoding: options.encoding,
      expectedModifiedAt: options.expectedModifiedAt,
      expectedTotalBytes: options.expectedTotalBytes
    });
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
