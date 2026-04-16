import { exec } from "node:child_process";
import os from "node:os";
import iconv from "iconv-lite";

export function runCommand(command, options) {
  const platform = os.platform();
  const executedCommand = normalizeCommandForExecution(command, platform);
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    exec(
      executedCommand,
      {
        timeout: options.commandTimeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true,
        shell: platform === "win32" ? process.env.ComSpec : undefined,
        encoding: platform === "win32" ? "buffer" : "utf8"
      },
      (error, stdout, stderr) => {
        const completedAt = new Date().toISOString();
        const decodedStdout = decodeCommandOutput(stdout, platform, options);
        const decodedStderr = decodeCommandOutput(stderr, platform, options);

        if (!error) {
          resolve({
            status: "completed",
            exitCode: 0,
            stdout: decodedStdout,
            stderr: decodedStderr,
            executedCommand,
            startedAt,
            completedAt
          });
          return;
        }

        resolve({
          status: error.killed ? "timed_out" : "failed",
          exitCode: typeof error.code === "number" ? error.code : null,
          stdout: decodedStdout,
          stderr: decodedStderr,
          error: buildErrorMessage(error, executedCommand, decodedStdout, decodedStderr),
          executedCommand,
          startedAt,
          completedAt
        });
      }
    );
  });
}

export function normalizeCommandForExecution(command, platform = os.platform()) {
  if (platform !== "win32") {
    return command;
  }

  const match = /^\s*which\s+(.+?)\s*$/i.exec(command);

  if (!match) {
    return command;
  }

  // Keep a tiny compatibility layer for Unix-style lookup commands sent to Windows agents.
  return `where.exe ${normalizeWindowsLookupTarget(match[1])}`;
}

function normalizeWindowsLookupTarget(targetExpression) {
  const trimmed = targetExpression.trim();

  if (/^["']?nodejs["']?$/i.test(trimmed)) {
    return trimmed.replace(/nodejs/i, "node");
  }

  return trimmed;
}

function decodeCommandOutput(value, platform, options) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (platform === "win32") {
    return iconv.decode(value, options.windowsOutputEncoding);
  }

  return Buffer.from(value).toString("utf8");
}

function buildErrorMessage(error, executedCommand, stdout, stderr) {
  const details = stderr || stdout;

  if (details) {
    return `Command failed: ${executedCommand}\n${details}`.trimEnd();
  }

  return error.message;
}
