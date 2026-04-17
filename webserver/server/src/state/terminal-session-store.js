import { randomUUID } from "node:crypto";

export class TerminalSessionStore {
  constructor(limit, outputLimit) {
    this.limit = limit;
    this.outputLimit = outputLimit;
    this.sessions = new Map();
    this.order = [];
    this.inputReceiptLimit = Math.max(200, outputLimit);
    this.inputReceipts = new Map();
  }

  create({ agentId, profile, sessionType = "llm_cli", metadata = {} }) {
    const createdAt = new Date().toISOString();
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const record = {
      sessionId,
      requestId,
      agentId,
      sessionType,
      profile,
      status: "created",
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      lastOutputAt: null,
      closedAt: null,
      exitCode: null,
      error: "",
      outputs: [],
      ...metadata
    };

    this.sessions.set(sessionId, record);
    this.order.unshift(sessionId);
    this.prune();
    return record;
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  getInputReceipt(sessionId, inputId) {
    const bucket = this.inputReceipts.get(sessionId);
    return bucket?.items.get(inputId) || null;
  }

  rememberInputReceipt(sessionId, inputId, receipt) {
    if (!this.sessions.has(sessionId)) {
      return null;
    }

    let bucket = this.inputReceipts.get(sessionId);

    if (!bucket) {
      bucket = {
        items: new Map(),
        order: []
      };
      this.inputReceipts.set(sessionId, bucket);
    }

    if (!bucket.items.has(inputId)) {
      bucket.order.push(inputId);
    }

    bucket.items.set(inputId, receipt);

    while (bucket.order.length > this.inputReceiptLimit) {
      const oldestInputId = bucket.order.shift();
      bucket.items.delete(oldestInputId);
    }

    return receipt;
  }

  update(sessionId, patch) {
    const record = this.sessions.get(sessionId);

    if (!record) {
      return null;
    }

    Object.assign(record, patch, {
      updatedAt: new Date().toISOString()
    });

    return record;
  }

  appendOutput(sessionId, payload) {
    const record = this.sessions.get(sessionId);

    if (!record) {
      return null;
    }

    const output = {
      sessionId,
      stream: payload.stream || "stdout",
      chunk: payload.chunk || "",
      seq: typeof payload.seq === "number" ? payload.seq : record.outputs.length + 1,
      sentAt: payload.sentAt || new Date().toISOString()
    };

    record.outputs.push(output);

    if (record.outputs.length > this.outputLimit) {
      record.outputs.splice(0, record.outputs.length - this.outputLimit);
    }

    record.lastOutputAt = output.sentAt;
    record.updatedAt = output.sentAt;
    return {
      record,
      output
    };
  }

  list(limit = this.limit) {
    return this.order
      .map((sessionId) => this.sessions.get(sessionId))
      .filter(Boolean)
      .slice(0, limit);
  }

  markAgentDisconnected(agentId) {
    return this.order
      .map((sessionId) => this.sessions.get(sessionId))
      .filter(Boolean)
      .filter(
        (session) =>
          session.agentId === agentId &&
          ["created", "dispatched", "running", "terminating"].includes(session.status)
      )
      .map((session) =>
        this.update(session.sessionId, {
          status: "connection_lost",
          error: "Agent disconnected before the terminal session was closed."
        })
      );
  }

  prune() {
    while (this.order.length > this.limit) {
      const sessionId = this.order.pop();
      this.sessions.delete(sessionId);
      this.inputReceipts.delete(sessionId);
    }
  }
}
