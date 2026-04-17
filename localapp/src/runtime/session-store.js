export class SessionStore {
  constructor(limit, outputLimit) {
    this.limit = limit;
    this.outputLimit = outputLimit;
    this.sessions = new Map();
    this.order = [];
  }

  create({
    sessionId,
    agentId,
    requestId,
    source,
    profile,
    sessionType,
    cwd,
    envKeys,
    cols,
    rows
  }) {
    const createdAt = new Date().toISOString();
    const record = {
      sessionId,
      agentId,
      requestId,
      source,
      profile,
      sessionType,
      cwd,
      envKeys,
      cols: cols || null,
      rows: rows || null,
      status: "starting",
      pid: null,
      startedAt: null,
      lastInputAt: null,
      lastOutputAt: null,
      closedAt: null,
      exitCode: null,
      error: "",
      outputs: [],
      createdAt,
      updatedAt: createdAt
    };

    this.sessions.set(sessionId, record);
    this.order.unshift(sessionId);
    this.prune();
    return record;
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

  appendOutput(sessionId, patch) {
    const record = this.sessions.get(sessionId);

    if (!record) {
      return null;
    }

    const output = {
      sessionId,
      stream: patch.stream || "stdout",
      chunk: patch.chunk || "",
      seq: record.outputs.length > 0 ? record.outputs[record.outputs.length - 1].seq + 1 : 1,
      sentAt: patch.sentAt || new Date().toISOString()
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

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  list() {
    return this.order
      .map((sessionId) => this.sessions.get(sessionId))
      .filter(Boolean);
  }

  prune() {
    while (this.order.length > this.limit) {
      const sessionId = this.order.pop();
      this.sessions.delete(sessionId);
    }
  }
}
