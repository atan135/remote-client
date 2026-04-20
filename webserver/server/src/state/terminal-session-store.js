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
      displayMode: "terminal",
      finalText: "",
      finalTextUpdatedAt: null,
      rawTranscript: "",
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

  upsert(sessionLike) {
    const normalized = normalizeSessionRecord(sessionLike, this.outputLimit);

    if (!normalized) {
      return null;
    }

    const existing = this.sessions.get(normalized.sessionId);

    if (!existing) {
      this.sessions.set(normalized.sessionId, normalized);
      this.order.unshift(normalized.sessionId);
      this.prune();
      return normalized;
    }

    Object.assign(existing, normalized);
    return existing;
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

    record.rawTranscript = clampTextTail(`${String(record.rawTranscript || "")}${output.chunk}`, 200000);
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

function clampTextTail(value, maxLength) {
  const text = String(value || "");

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(text.length - maxLength);
}

function normalizeSessionRecord(sessionLike, outputLimit) {
  const sessionId = String(sessionLike?.sessionId || "").trim();

  if (!sessionId) {
    return null;
  }

  const createdAt = normalizeIsoTimestamp(sessionLike?.createdAt) || new Date().toISOString();
  const outputs = normalizeOutputs(sessionLike?.outputs, outputLimit, sessionId);
  const rawTranscriptSource =
    typeof sessionLike?.rawTranscript === "string"
      ? sessionLike.rawTranscript
      : outputs.map((output) => output.chunk).join("");

  return {
    sessionId,
    requestId: String(sessionLike?.requestId || ""),
    agentId: String(sessionLike?.agentId || ""),
    operatorUserId:
      typeof sessionLike?.operatorUserId === "number" && Number.isFinite(sessionLike.operatorUserId)
        ? sessionLike.operatorUserId
        : null,
    operatorUsername: String(sessionLike?.operatorUsername || ""),
    authCodeId:
      typeof sessionLike?.authCodeId === "number" && Number.isFinite(sessionLike.authCodeId)
        ? sessionLike.authCodeId
        : null,
    authCodeFingerprint: String(sessionLike?.authCodeFingerprint || ""),
    authCodeRemark: String(sessionLike?.authCodeRemark || ""),
    sessionType: String(sessionLike?.sessionType || "llm_cli"),
    profile: String(sessionLike?.profile || ""),
    status: String(sessionLike?.status || "created"),
    createdAt,
    updatedAt:
      normalizeIsoTimestamp(sessionLike?.updatedAt) ||
      normalizeIsoTimestamp(sessionLike?.lastOutputAt) ||
      createdAt,
    startedAt: normalizeIsoTimestamp(sessionLike?.startedAt),
    lastInputAt: normalizeIsoTimestamp(sessionLike?.lastInputAt),
    lastOutputAt: normalizeIsoTimestamp(sessionLike?.lastOutputAt),
    closedAt: normalizeIsoTimestamp(sessionLike?.closedAt),
    exitCode:
      typeof sessionLike?.exitCode === "number" && Number.isFinite(sessionLike.exitCode)
        ? sessionLike.exitCode
        : null,
    error: String(sessionLike?.error || ""),
    displayMode: String(sessionLike?.displayMode || "terminal"),
    finalOutputMarkers: normalizeFinalOutputMarkers(sessionLike?.finalOutputMarkers),
    finalText: String(sessionLike?.finalText || ""),
    finalTextUpdatedAt: normalizeIsoTimestamp(sessionLike?.finalTextUpdatedAt),
    rawTranscript: clampTextTail(rawTranscriptSource, 200000),
    outputs,
    cwd: String(sessionLike?.cwd || ""),
    envKeys: Array.isArray(sessionLike?.envKeys)
      ? sessionLike.envKeys.map((item) => String(item))
      : [],
    cols:
      typeof sessionLike?.cols === "number" && Number.isFinite(sessionLike.cols)
        ? sessionLike.cols
        : null,
    rows:
      typeof sessionLike?.rows === "number" && Number.isFinite(sessionLike.rows)
        ? sessionLike.rows
        : null,
    pid: typeof sessionLike?.pid === "number" && Number.isFinite(sessionLike.pid) ? sessionLike.pid : null,
    source: String(sessionLike?.source || "")
  };
}

function normalizeOutputs(outputs, outputLimit, sessionId) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return [];
  }

  return outputs
    .map((output, index) => ({
      sessionId: String(output?.sessionId || sessionId),
      stream: String(output?.stream || "stdout"),
      chunk: String(output?.chunk || ""),
      seq: Number.isFinite(Number(output?.seq)) ? Number(output.seq) : index + 1,
      sentAt: normalizeIsoTimestamp(output?.sentAt) || new Date().toISOString()
    }))
    .sort((left, right) => left.seq - right.seq)
    .slice(-outputLimit);
}

function normalizeIsoTimestamp(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
