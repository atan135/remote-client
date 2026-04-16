export class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this.sockets = new Map();
  }

  register(payload, socket) {
    const now = new Date().toISOString();
    const previous = this.agents.get(payload.agentId);

    const agent = {
      agentId: payload.agentId,
      label: payload.label || payload.agentId,
      hostname: payload.hostname || "",
      platform: payload.platform || "",
      arch: payload.arch || "",
      pid: payload.pid || null,
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

  list() {
    return Array.from(this.agents.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }
}

