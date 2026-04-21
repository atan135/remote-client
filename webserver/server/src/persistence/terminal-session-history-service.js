const TURN_EXTRACTION_PENDING = "pending";
const TURN_EXTRACTION_EXTRACTED = "extracted";
const TURN_EXTRACTION_EMPTY = "empty";

export class TerminalSessionHistoryService {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureTables() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id CHAR(36) NOT NULL,
        request_id CHAR(36) NOT NULL,
        agent_id VARCHAR(128) NOT NULL,
        operator_user_id BIGINT UNSIGNED NULL,
        operator_username VARCHAR(64) NOT NULL DEFAULT '',
        profile VARCHAR(128) NOT NULL,
        session_type VARCHAR(64) NOT NULL DEFAULT 'llm_cli',
        display_mode VARCHAR(32) NOT NULL DEFAULT 'terminal',
        cwd VARCHAR(1024) NOT NULL DEFAULT '',
        status VARCHAR(32) NOT NULL,
        exit_code INT NULL,
        error_message TEXT NOT NULL,
        final_text LONGTEXT NOT NULL,
        final_text_chars INT UNSIGNED NOT NULL DEFAULT 0,
        raw_excerpt_tail MEDIUMTEXT NOT NULL,
        raw_char_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        started_at DATETIME NULL,
        last_output_at DATETIME NULL,
        closed_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_terminal_sessions_session_id (session_id),
        UNIQUE KEY uk_terminal_sessions_request_id (request_id),
        KEY idx_terminal_sessions_created_at (created_at),
        KEY idx_terminal_sessions_agent_created (agent_id, created_at),
        KEY idx_terminal_sessions_operator_created (operator_user_id, created_at),
        CONSTRAINT fk_terminal_sessions_operator_user_id
          FOREIGN KEY (operator_user_id) REFERENCES users (id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureIndex(
      this.pool,
      "terminal_sessions",
      "idx_terminal_sessions_created_at",
      "ALTER TABLE terminal_sessions ADD INDEX idx_terminal_sessions_created_at (created_at)"
    );

    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS terminal_session_turns (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id CHAR(36) NOT NULL,
        turn_no INT UNSIGNED NOT NULL,
        input_text LONGTEXT NOT NULL,
        final_text LONGTEXT NOT NULL,
        extraction_status VARCHAR(32) NOT NULL DEFAULT 'pending',
        raw_excerpt_tail MEDIUMTEXT NOT NULL,
        input_created_at DATETIME NOT NULL,
        finalized_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_terminal_session_turns_session_turn (session_id, turn_no),
        KEY idx_terminal_session_turns_session_created (session_id, created_at),
        CONSTRAINT fk_terminal_session_turns_session_id
          FOREIGN KEY (session_id) REFERENCES terminal_sessions (session_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async upsertSession(record) {
    const summary = summarizeTerminalSessionRecord(record);
    await this.pool.execute(
      `
        INSERT INTO terminal_sessions (
          session_id,
          request_id,
          agent_id,
          operator_user_id,
          operator_username,
          profile,
          session_type,
          display_mode,
          cwd,
          status,
          exit_code,
          error_message,
          final_text,
          final_text_chars,
          raw_excerpt_tail,
          raw_char_count,
          created_at,
          updated_at,
          started_at,
          last_output_at,
          closed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          request_id = VALUES(request_id),
          agent_id = VALUES(agent_id),
          operator_user_id = VALUES(operator_user_id),
          operator_username = VALUES(operator_username),
          profile = VALUES(profile),
          session_type = VALUES(session_type),
          display_mode = VALUES(display_mode),
          cwd = VALUES(cwd),
          status = VALUES(status),
          exit_code = VALUES(exit_code),
          error_message = VALUES(error_message),
          final_text = VALUES(final_text),
          final_text_chars = VALUES(final_text_chars),
          raw_excerpt_tail = VALUES(raw_excerpt_tail),
          raw_char_count = VALUES(raw_char_count),
          updated_at = VALUES(updated_at),
          started_at = VALUES(started_at),
          last_output_at = VALUES(last_output_at),
          closed_at = VALUES(closed_at)
      `,
      [
        summary.sessionId,
        summary.requestId,
        summary.agentId,
        summary.operatorUserId,
        summary.operatorUsername,
        summary.profile,
        summary.sessionType,
        summary.displayMode,
        summary.cwd,
        summary.status,
        summary.exitCode,
        summary.error,
        summary.finalText,
        summary.finalTextChars,
        summary.rawExcerptTail,
        summary.rawCharCount,
        toMysqlDateTime(summary.createdAt),
        toMysqlDateTime(summary.updatedAt),
        toMysqlDateTime(summary.startedAt),
        toMysqlDateTime(summary.lastOutputAt),
        toMysqlDateTime(summary.closedAt)
      ]
    );
  }

  async beginTurn(sessionId, inputText, inputCreatedAt = new Date().toISOString()) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedInput = String(inputText || "").trim();

    if (!normalizedSessionId || !normalizedInput) {
      return null;
    }

    const [rows] = await this.pool.execute(
      `
        SELECT COALESCE(MAX(turn_no), 0) AS max_turn
        FROM terminal_session_turns
        WHERE session_id = ?
      `,
      [normalizedSessionId]
    );

    const nextTurnNo = Number(rows[0]?.max_turn || 0) + 1;

    await this.pool.execute(
      `
        INSERT INTO terminal_session_turns (
          session_id,
          turn_no,
          input_text,
          final_text,
          extraction_status,
          raw_excerpt_tail,
          input_created_at,
          finalized_at
        )
        VALUES (?, ?, ?, '', ?, '', ?, NULL)
      `,
      [
        normalizedSessionId,
        nextTurnNo,
        normalizedInput,
        TURN_EXTRACTION_PENDING,
        toMysqlDateTime(inputCreatedAt)
      ]
    );

    return nextTurnNo;
  }

  async syncLatestTurn(sessionId, sessionRecord, options = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const allowEmpty = options.allowEmpty === true;

    if (!normalizedSessionId) {
      return;
    }

    const finalText = String(sessionRecord?.finalText || "").trim();

    if (!finalText && !allowEmpty) {
      return;
    }

    const [rows] = await this.pool.execute(
      `
        SELECT id
        FROM terminal_session_turns
        WHERE session_id = ?
        ORDER BY turn_no DESC
        LIMIT 1
      `,
      [normalizedSessionId]
    );

    const turnId = rows[0]?.id;

    if (!turnId) {
      return;
    }

    const extractionStatus = finalText ? TURN_EXTRACTION_EXTRACTED : TURN_EXTRACTION_EMPTY;

    await this.pool.execute(
      `
        UPDATE terminal_session_turns
        SET
          final_text = ?,
          extraction_status = ?,
          raw_excerpt_tail = ?,
          finalized_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        clampText(finalText, 200000),
        extractionStatus,
        createRawExcerptTail(sessionRecord?.rawTranscript),
        toMysqlDateTime(
          sessionRecord?.finalTextUpdatedAt || sessionRecord?.closedAt || new Date().toISOString()
        ),
        turnId
      ]
    );
  }

  async listRecent(limit = 100) {
    const normalizedLimit = normalizeLimit(limit, 100);
    const [rows] = await this.pool.execute(
      `
        SELECT
          session_id,
          request_id,
          agent_id,
          operator_user_id,
          operator_username,
          profile,
          session_type,
          display_mode,
          cwd,
          status,
          exit_code,
          error_message,
          final_text,
          final_text_chars,
          raw_char_count,
          created_at,
          updated_at,
          started_at,
          last_output_at,
          closed_at
        FROM terminal_sessions
        ORDER BY created_at DESC
        LIMIT ${normalizedLimit}
      `
    );

    return rows.map(serializeStoredTerminalSession);
  }

  async getBySessionId(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return null;
    }

    const [rows] = await this.pool.execute(
      `
        SELECT
          session_id,
          request_id,
          agent_id,
          operator_user_id,
          operator_username,
          profile,
          session_type,
          display_mode,
          cwd,
          status,
          exit_code,
          error_message,
          final_text,
          final_text_chars,
          raw_char_count,
          created_at,
          updated_at,
          started_at,
          last_output_at,
          closed_at
        FROM terminal_sessions
        WHERE session_id = ?
        LIMIT 1
      `,
      [normalizedSessionId]
    );

    return rows[0] ? serializeStoredTerminalSession(rows[0]) : null;
  }

  async updateSession(sessionId, patch = {}) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return null;
    }

    const assignments = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      assignments.push("status = ?");
      values.push(String(patch.status || ""));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "exitCode")) {
      assignments.push("exit_code = ?");
      values.push(toNullableNumber(patch.exitCode));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "error")) {
      assignments.push("error_message = ?");
      values.push(clampText(String(patch.error || ""), 4000));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "updatedAt")) {
      assignments.push("updated_at = ?");
      values.push(toMysqlDateTime(patch.updatedAt));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "closedAt")) {
      assignments.push("closed_at = ?");
      values.push(toMysqlDateTime(patch.closedAt));
    }

    if (assignments.length === 0) {
      return this.getBySessionId(normalizedSessionId);
    }

    await this.pool.execute(
      `
        UPDATE terminal_sessions
        SET ${assignments.join(", ")}
        WHERE session_id = ?
      `,
      [...values, normalizedSessionId]
    );

    return this.getBySessionId(normalizedSessionId);
  }

  async deleteSession(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return false;
    }

    const [result] = await this.pool.execute(
      `
        DELETE FROM terminal_sessions
        WHERE session_id = ?
      `,
      [normalizedSessionId]
    );

    return Number(result?.affectedRows || 0) > 0;
  }
}

export function summarizeTerminalSessionRecord(record) {
  const finalText = String(record?.finalText || "");
  const rawTranscript = String(record?.rawTranscript || "");

  return {
    sessionId: String(record?.sessionId || ""),
    requestId: String(record?.requestId || ""),
    agentId: String(record?.agentId || ""),
    operatorUserId: toNullableNumber(record?.operatorUserId),
    operatorUsername: String(record?.operatorUsername || ""),
    profile: String(record?.profile || ""),
    sessionType: String(record?.sessionType || "llm_cli"),
    displayMode: String(record?.displayMode || "terminal"),
    cwd: String(record?.cwd || ""),
    status: String(record?.status || ""),
    exitCode: toNullableNumber(record?.exitCode),
    error: clampText(String(record?.error || ""), 4000),
    finalText: clampText(finalText, 200000),
    finalTextChars: finalText.length,
    rawExcerptTail: createRawExcerptTail(rawTranscript),
    rawCharCount: rawTranscript.length,
    createdAt: record?.createdAt || null,
    updatedAt: record?.updatedAt || record?.createdAt || null,
    startedAt: record?.startedAt || null,
    lastOutputAt: record?.lastOutputAt || null,
    closedAt: record?.closedAt || null
  };
}

function createRawExcerptTail(text) {
  const value = String(text || "");

  if (!value) {
    return "";
  }

  return clampText(value.slice(-8000), 8000);
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function toMysqlDateTime(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function toNullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback;
}

export function serializeStoredTerminalSession(row) {
  return {
    sessionId: row.session_id,
    requestId: row.request_id,
    agentId: row.agent_id,
    operatorUserId: row.operator_user_id ?? null,
    operatorUsername: row.operator_username || "",
    profile: row.profile || "",
    sessionType: row.session_type || "llm_cli",
    displayMode: row.display_mode || "terminal",
    cwd: row.cwd || "",
    status: row.status || "",
    exitCode: typeof row.exit_code === "number" ? row.exit_code : null,
    error: row.error_message || "",
    finalText: row.final_text || "",
    finalTextChars: Number(row.final_text_chars || 0),
    rawCharCount: Number(row.raw_char_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    startedAt: row.started_at || null,
    lastOutputAt: row.last_output_at || null,
    closedAt: row.closed_at || null,
    outputs: []
  };
}

async function ensureIndex(pool, tableName, indexName, alterSql) {
  const [rows] = await pool.execute(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return;
  }

  await pool.execute(alterSql);
}
