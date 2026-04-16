import { randomUUID } from "node:crypto";

export class CommandStore {
  constructor(limit) {
    this.limit = limit;
    this.commands = new Map();
    this.order = [];
  }

  create({ agentId, command, metadata = {} }) {
    const createdAt = new Date().toISOString();
    const requestId = randomUUID();
    const record = {
      requestId,
      agentId,
      command,
      ...metadata,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      dispatchedAt: null,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: ""
    };

    this.commands.set(requestId, record);
    this.order.unshift(requestId);
    this.prune();
    return record;
  }

  update(requestId, patch) {
    const record = this.commands.get(requestId);

    if (!record) {
      return null;
    }

    Object.assign(record, patch, {
      updatedAt: new Date().toISOString()
    });

    return record;
  }

  list({ agentId, limit }) {
    return this.order
      .map((requestId) => this.commands.get(requestId))
      .filter(Boolean)
      .filter((command) => !agentId || command.agentId === agentId)
      .slice(0, limit);
  }

  listQueued(agentId) {
    return this.order
      .map((requestId) => this.commands.get(requestId))
      .filter(Boolean)
      .filter((command) => command.agentId === agentId && command.status === "queued");
  }

  markAgentDisconnected(agentId) {
    return this.order
      .map((requestId) => this.commands.get(requestId))
      .filter(Boolean)
      .filter(
        (command) =>
          command.agentId === agentId &&
          (command.status === "dispatched" || command.status === "running")
      )
      .map((command) =>
        this.update(command.requestId, {
          status: "connection_lost",
          error: "Agent disconnected before the result was confirmed."
        })
      );
  }

  prune() {
    while (this.order.length > this.limit) {
      const requestId = this.order.pop();
      this.commands.delete(requestId);
    }
  }
}
