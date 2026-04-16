import { exec } from "node:child_process";
import os from "node:os";

export function runCommand(command, options) {
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout: options.commandTimeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true,
        shell: os.platform() === "win32" ? process.env.ComSpec : undefined
      },
      (error, stdout, stderr) => {
        const completedAt = new Date().toISOString();

        if (!error) {
          resolve({
            status: "completed",
            exitCode: 0,
            stdout,
            stderr,
            startedAt,
            completedAt
          });
          return;
        }

        resolve({
          status: error.killed ? "timed_out" : "failed",
          exitCode: typeof error.code === "number" ? error.code : null,
          stdout,
          stderr,
          error: error.message,
          startedAt,
          completedAt
        });
      }
    );
  });
}

