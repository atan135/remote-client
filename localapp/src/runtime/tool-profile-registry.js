import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");

export class ToolProfileRegistry {
  constructor(config) {
    this.config = config;
    this.profiles = this.loadProfiles();
  }

  loadProfiles() {
    const builtInProfiles = createBuiltInProfiles(this.config);
    const configPath = path.resolve(packageRoot, this.config.taskProfileConfigPath);

    if (!fs.existsSync(configPath)) {
      return builtInProfiles;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const fileProfiles = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
    const merged = { ...builtInProfiles };

    for (const [profileName, profileConfig] of Object.entries(fileProfiles)) {
      merged[profileName] = normalizeProfile(profileName, {
        ...(merged[profileName] || {}),
        ...profileConfig
      });
    }

    return merged;
  }

  getProfile(profileName) {
    const profile = this.profiles[profileName];

    if (!profile) {
      throw new Error(`未找到终端 profile: ${profileName}`);
    }

    return profile;
  }

  listProfiles() {
    return Object.values(this.profiles).map((profile) => ({
      name: profile.name,
      runner: profile.runner,
      command: profile.command,
      cwdPolicy: profile.cwdPolicy,
      outputMode: profile.outputMode,
      finalOutputMarkers: profile.finalOutputMarkers
        ? { ...profile.finalOutputMarkers }
        : null,
      idleTimeoutMs: profile.idleTimeoutMs,
      envAllowlist: [...profile.envAllowlist]
    }));
  }

  resolveSessionLaunch({ profileName, cwd, env = {} }) {
    const profile = this.getProfile(profileName);

    if (profile.runner !== "pty") {
      throw new Error(`profile ${profileName} 不是 PTY 会话类型`);
    }

    return {
      profile,
      command: profile.command,
      args: [...profile.argsTemplate],
      cwd: resolveAllowedCwd(cwd || process.cwd(), this.config.allowedCwdRoots),
      env: buildProcessEnv(profile.envAllowlist, env)
    };
  }
}

function createBuiltInProfiles(config) {
  return {
    default_shell_session: normalizeProfile("default_shell_session", {
      runner: "pty",
      command: config.defaultShell,
      argsTemplate: createDefaultShellArgsTemplate(config.defaultShell),
      cwdPolicy: "allowlist",
      outputMode: "terminal",
      envAllowlist: [
        "PATH",
        "PATHEXT",
        "TERM",
        "HOME",
        "USERPROFILE",
        "TMP",
        "TEMP",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY"
      ],
      idleTimeoutMs: config.sessionIdleTimeoutMs
    }),
    claude_code_session: normalizeProfile("claude_code_session", {
      runner: "pty",
      command: "claude",
      argsTemplate: [],
      cwdPolicy: "allowlist",
      outputMode: "final_only",
      finalOutputMarkers: {
        start: "<<<FINAL>>>",
        end: "<<<END_FINAL>>>"
      },
      envAllowlist: [
        "ANTHROPIC_API_KEY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY"
      ],
      idleTimeoutMs: 30 * 60 * 1000
    })
  };
}

function normalizeProfile(profileName, profileConfig) {
  return {
    name: profileName,
    runner: String(profileConfig.runner || "pty"),
    command: String(profileConfig.command || "").trim(),
    argsTemplate: Array.isArray(profileConfig.argsTemplate)
      ? profileConfig.argsTemplate.map((item) => String(item))
      : [],
    cwdPolicy: String(profileConfig.cwdPolicy || "allowlist"),
    outputMode: normalizeOutputMode(profileConfig.outputMode),
    finalOutputMarkers: normalizeFinalOutputMarkers(profileConfig.finalOutputMarkers),
    envAllowlist: Array.isArray(profileConfig.envAllowlist)
      ? profileConfig.envAllowlist.map((item) => String(item))
      : [],
    idleTimeoutMs: Number(profileConfig.idleTimeoutMs) || 30 * 60 * 1000
  };
}

function normalizeOutputMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["terminal", "final_only", "hybrid"].includes(normalized) ? normalized : "terminal";
}

function normalizeFinalOutputMarkers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const start = String(value.start || "").trim();
  const end = String(value.end || "").trim();

  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function buildProcessEnv(allowlist, extraEnv) {
  const nextEnv = { ...process.env };

  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(extraEnv, key)) {
      nextEnv[key] = String(extraEnv[key]);
    }
  }

  return nextEnv;
}

function resolveAllowedCwd(cwd, allowedRoots) {
  const resolvedCwd = path.resolve(cwd);

  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    return resolvedCwd;
  }

  const normalizedCwd = normalizeForComparison(resolvedCwd);
  const isAllowed = allowedRoots.some((root) => {
    const normalizedRoot = normalizeForComparison(path.resolve(root));
    return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}${path.sep}`);
  });

  if (!isAllowed) {
    throw new Error(`cwd 不在允许范围内: ${resolvedCwd}`);
  }

  return resolvedCwd;
}

function normalizeForComparison(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createDefaultShellArgsTemplate(command) {
  if (process.platform !== "win32" || !isPowerShellExecutable(command)) {
    return [];
  }

  return [
    "-NoLogo",
    "-NoExit",
    "-Command",
    createPowerShellUtf8InitScript()
  ];
}

function isPowerShellExecutable(command) {
  const executableName = path.basename(String(command || "").trim()).toLowerCase();
  return executableName === "powershell" ||
    executableName === "powershell.exe" ||
    executableName === "pwsh" ||
    executableName === "pwsh.exe";
}

function createPowerShellUtf8InitScript() {
  return [
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
    "chcp 65001 > $null"
  ].join("; ");
}
