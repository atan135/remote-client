import pty from "node-pty";

export class TerminalSessionRunner {
  spawnSession({ command, args, cwd, env, cols = 120, rows = 30 }) {
    return pty.spawn(command, args, {
      name: "xterm-color",
      cwd,
      env,
      cols,
      rows,
      useConpty: process.platform === "win32" ? false : undefined
    });
  }
}
