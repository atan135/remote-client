import pty from "node-pty";

export class TerminalSessionRunner {
  constructor(config = {}) {
    this.config = config;
  }

  spawnSession({ command, args, cwd, env, cols = 120, rows = 30 }) {
    return pty.spawn(command, args, {
      name: "xterm-color",
      cwd,
      env,
      cols,
      rows,
      useConpty: process.platform === "win32" ? this.config.windowsUseConpty : undefined,
      useConptyDll: process.platform === "win32" ? this.config.windowsUseConptyDll : undefined
    });
  }
}
