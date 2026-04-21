export class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this.sockets = new Map();
  }

  register(payload, socket) {
    const now = new Date().toISOString();
    const previous = this.agents.get(payload.agentId);
    const terminalProfiles = normalizeTerminalProfiles(payload.terminalProfiles);
    const hasPresetCommands = Array.isArray(payload.presetCommands);
    const presetCommands = normalizePresetCommands(payload.presetCommands);
    const hasCommonWorkingDirectories = Array.isArray(payload.commonWorkingDirectories);
    const commonWorkingDirectories = normalizeDirectoryList(payload.commonWorkingDirectories);

    const agent = {
      agentId: payload.agentId,
      label: payload.label || payload.agentId,
      hostname: payload.hostname || "",
      platform: payload.platform || "",
      arch: payload.arch || "",
      pid: payload.pid || null,
      presetCommands: hasPresetCommands ? presetCommands : previous?.presetCommands || [],
      commonWorkingDirectories: hasCommonWorkingDirectories
        ? commonWorkingDirectories
        : previous?.commonWorkingDirectories || [],
      terminalProfiles:
        terminalProfiles.length > 0 ? terminalProfiles : previous?.terminalProfiles || [],
      status: "online",
      connectedAt: previous?.connectedAt || now,
      lastDisconnectAt: previous?.lastDisconnectAt || null,
      lastSeenAt: now
    };

    this.agents.set(payload.agentId, agent);
    this.sockets.set(payload.agentId, socket);

    return agent;
  }

  heartbeat(agentId) {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return null;
    }

    agent.lastSeenAt = new Date().toISOString();
    agent.status = "online";
    return agent;
  }

  disconnect(agentId) {
    if (!agentId) {
      return null;
    }

    this.sockets.delete(agentId);

    const agent = this.agents.get(agentId);

    if (!agent) {
      return null;
    }

    agent.status = "offline";
    agent.lastDisconnectAt = new Date().toISOString();
    return agent;
  }

  getSocket(agentId) {
    return this.sockets.get(agentId) || null;
  }

  get(agentId) {
    return this.agents.get(agentId) || null;
  }

  list() {
    return Array.from(this.agents.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }
}

function normalizePresetCommands(presetCommands) {
  if (!Array.isArray(presetCommands)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const item of presetCommands) {
    const label = String(item?.label || "").trim();
    const command = String(item?.command || "").trim();

    if (!command) {
      continue;
    }

    const resolvedLabel = label || command;
    const dedupeKey = `${resolvedLabel}\u0000${command}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      label: resolvedLabel,
      command
    });
  }

  return normalized;
}

function normalizeTerminalProfiles(profiles) {
  if (!Array.isArray(profiles)) {
    return [];
  }

  return profiles
    .map((profile) => ({
      name: String(profile?.name || "").trim(),
      label: String(profile?.label || profile?.name || "").trim(),
      runner: String(profile?.runner || "").trim(),
      command: String(profile?.command || "").trim(),
      cwdPolicy: String(profile?.cwdPolicy || "").trim(),
      outputMode: String(profile?.outputMode || "terminal").trim() || "terminal",
      finalOutputMarkers:
        profile?.finalOutputMarkers &&
        typeof profile.finalOutputMarkers === "object" &&
        !Array.isArray(profile.finalOutputMarkers)
          ? {
              start: String(profile.finalOutputMarkers.start || "").trim(),
              end: String(profile.finalOutputMarkers.end || "").trim()
            }
          : null,
      idleTimeoutMs: Number(profile?.idleTimeoutMs) || 0,
      envAllowlist: Array.isArray(profile?.envAllowlist)
        ? profile.envAllowlist.map((item) => String(item))
        : [],
      isAvailable: profile?.isAvailable !== false,
      unavailableReason: String(profile?.unavailableReason || ""),
      source: String(profile?.source || "").trim(),
      kind: String(profile?.kind || "").trim(),
      description: String(profile?.description || "").trim(),
      recommended: profile?.recommended === true
    }))
    .filter((profile) => profile.name);
}

function normalizeDirectoryList(directories) {
  if (!Array.isArray(directories)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const candidate of directories) {
    const value = String(candidate || "").trim();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}
