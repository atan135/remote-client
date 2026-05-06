import { exec } from "node:child_process";
import os from "node:os";
import iconv from "iconv-lite";

const SUPPORTED_COMMAND_SHELLS = new Set(["cmd", "powershell", "pwsh", "bash"]);

export function runCommand(command, options, executionOptions = {}) {
  const platform = os.platform();
  const commandShell = normalizeCommandShell(executionOptions.shell, platform);
  const executedShell = resolveCommandShell(commandShell, platform);
  const executedCommand = normalizeCommandForExecution(command, platform, commandShell);
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    exec(
      executedCommand,
      {
        timeout: options.commandTimeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true,
        shell: executedShell,
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
            commandShell,
            executedShell,
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
          commandShell,
          executedShell,
          executedCommand,
          startedAt,
          completedAt
        });
      }
    );
  });
}

export function normalizeCommandForExecution(
  command,
  platform = os.platform(),
  commandShell = normalizeCommandShell("", platform)
) {
  if (platform !== "win32") {
    return command;
  }

  if (commandShell === "bash") {
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

export function normalizeCommandShell(value, platform = os.platform()) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^powershell7$/, "pwsh")
    .replace(/^power-shell$/, "powershell")
    .replace(/^ps$/, "powershell")
    .replace(/^ps7$/, "pwsh");

  if (SUPPORTED_COMMAND_SHELLS.has(normalized)) {
    return normalized;
  }

  return platform === "win32" ? "powershell" : "bash";
}

export function resolveCommandShell(commandShell, platform = os.platform()) {
  const normalized = normalizeCommandShell(commandShell, platform);

  if (platform === "win32") {
    switch (normalized) {
      case "cmd":
        return process.env.ComSpec || "cmd.exe";
      case "pwsh":
        return "pwsh.exe";
      case "bash":
        return "bash.exe";
      case "powershell":
      default:
        return "powershell.exe";
    }
  }

  switch (normalized) {
    case "cmd":
      return "cmd";
    case "powershell":
      return "powershell";
    case "pwsh":
      return "pwsh";
    case "bash":
    default:
      return "/bin/bash";
  }
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
