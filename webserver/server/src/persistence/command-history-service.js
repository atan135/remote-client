export class CommandHistoryService {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureTables() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS command_runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        request_id CHAR(36) NOT NULL,
        agent_id VARCHAR(128) NOT NULL,
        operator_user_id BIGINT UNSIGNED NULL,
        operator_username VARCHAR(64) NOT NULL DEFAULT '',
        command_text LONGTEXT NOT NULL,
        status VARCHAR(32) NOT NULL,
        secure_status VARCHAR(64) NOT NULL DEFAULT '',
        security_error TEXT NOT NULL,
        exit_code INT NULL,
        error_message TEXT NOT NULL,
        stdout_preview MEDIUMTEXT NOT NULL,
        stderr_preview MEDIUMTEXT NOT NULL,
        stdout_chars INT UNSIGNED NOT NULL DEFAULT 0,
        stderr_chars INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        dispatched_at DATETIME NULL,
        started_at DATETIME NULL,
        completed_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_command_runs_request_id (request_id),
        KEY idx_command_runs_created_at (created_at),
        KEY idx_command_runs_agent_created (agent_id, created_at),
        KEY idx_command_runs_operator_created (operator_user_id, created_at),
        CONSTRAINT fk_command_runs_operator_user_id
          FOREIGN KEY (operator_user_id) REFERENCES users (id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureIndex(
      this.pool,
      "command_runs",
      "idx_command_runs_created_at",
      "ALTER TABLE command_runs ADD INDEX idx_command_runs_created_at (created_at)"
    );
  }

  async create(record) {
    const summary = summarizeCommandRecord(record);
    await this.pool.execute(
      `
        INSERT INTO command_runs (
          request_id,
          agent_id,
          operator_user_id,
          operator_username,
          command_text,
          status,
          secure_status,
          security_error,
          exit_code,
          error_message,
          stdout_preview,
          stderr_preview,
          stdout_chars,
          stderr_chars,
          created_at,
          updated_at,
          dispatched_at,
          started_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          agent_id = VALUES(agent_id),
          operator_user_id = VALUES(operator_user_id),
          operator_username = VALUES(operator_username),
          command_text = VALUES(command_text),
          status = VALUES(status),
          secure_status = VALUES(secure_status),
          security_error = VALUES(security_error),
          exit_code = VALUES(exit_code),
          error_message = VALUES(error_message),
          stdout_preview = VALUES(stdout_preview),
          stderr_preview = VALUES(stderr_preview),
          stdout_chars = VALUES(stdout_chars),
          stderr_chars = VALUES(stderr_chars),
          updated_at = VALUES(updated_at),
          dispatched_at = VALUES(dispatched_at),
          started_at = VALUES(started_at),
          completed_at = VALUES(completed_at)
      `,
      [
        summary.requestId,
        summary.agentId,
        summary.operatorUserId,
        summary.operatorUsername,
        summary.command,
        summary.status,
        summary.secureStatus,
        summary.securityError,
        summary.exitCode,
        summary.error,
        summary.stdoutPreview,
        summary.stderrPreview,
        summary.stdoutChars,
        summary.stderrChars,
        toMysqlDateTime(summary.createdAt),
        toMysqlDateTime(summary.updatedAt),
        toMysqlDateTime(summary.dispatchedAt),
        toMysqlDateTime(summary.startedAt),
        toMysqlDateTime(summary.completedAt)
      ]
    );
  }

  async update(record) {
    return this.create(record);
  }

  async listRecent({ agentId = "", limit = 100 }) {
    const normalizedLimit = normalizeLimit(limit, 100);

    const [rows] = agentId
      ? await this.pool.execute(
          `
            SELECT
              request_id,
              agent_id,
              operator_user_id,
              operator_username,
              command_text,
              status,
              secure_status,
              security_error,
              exit_code,
              error_message,
              stdout_preview,
              stderr_preview,
              stdout_chars,
              stderr_chars,
              created_at,
              updated_at,
              dispatched_at,
              started_at,
              completed_at
            FROM command_runs
            WHERE agent_id = ?
            ORDER BY created_at DESC
            LIMIT ${normalizedLimit}
          `,
          [String(agentId || "")]
        )
      : await this.pool.execute(
          `
            SELECT
              request_id,
              agent_id,
              operator_user_id,
              operator_username,
              command_text,
              status,
              secure_status,
              security_error,
              exit_code,
              error_message,
              stdout_preview,
              stderr_preview,
              stdout_chars,
              stderr_chars,
              created_at,
              updated_at,
              dispatched_at,
              started_at,
              completed_at
            FROM command_runs
            ORDER BY created_at DESC
            LIMIT ${normalizedLimit}
          `
        );

    return rows.map(serializeStoredCommandRun);
  }

  async getByRequestId(requestId) {
    const normalizedRequestId = String(requestId || "").trim();

    if (!normalizedRequestId) {
      return null;
    }

    const [rows] = await this.pool.execute(
      `
        SELECT
          request_id,
          agent_id,
          operator_user_id,
          operator_username,
          command_text,
          status,
          secure_status,
          security_error,
          exit_code,
          error_message,
          stdout_preview,
          stderr_preview,
          stdout_chars,
          stderr_chars,
          created_at,
          updated_at,
          dispatched_at,
          started_at,
          completed_at
        FROM command_runs
        WHERE request_id = ?
        LIMIT 1
      `,
      [normalizedRequestId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return serializeStoredCommandRun(rows[0]);
  }

  async deleteByRequestId(requestId) {
    const normalizedRequestId = String(requestId || "").trim();

    if (!normalizedRequestId) {
      return false;
    }

    const [result] = await this.pool.execute(
      `
        DELETE FROM command_runs
        WHERE request_id = ?
        LIMIT 1
      `,
      [normalizedRequestId]
    );

    return Number(result?.affectedRows || 0) > 0;
  }

  async deleteClosedRuns({ agentId = "" } = {}) {
    const normalizedAgentId = String(agentId || "").trim();
    const activeStatuses = ["queued", "running", "dispatched"];
    const [result] = normalizedAgentId
      ? await this.pool.execute(
          `
            DELETE FROM command_runs
            WHERE agent_id = ?
              AND status NOT IN (?, ?, ?)
          `,
          [normalizedAgentId, ...activeStatuses]
        )
      : await this.pool.execute(
          `
            DELETE FROM command_runs
            WHERE status NOT IN (?, ?, ?)
          `,
          activeStatuses
        );

    return Number(result?.affectedRows || 0);
  }
}

export function summarizeCommandRecord(record) {
  const stdout = String(record?.stdout || "");
  const stderr = String(record?.stderr || "");
  const stdoutChars = toCount(record?.stdoutChars, stdout.length);
  const stderrChars = toCount(record?.stderrChars, stderr.length);

  return {
    requestId: String(record?.requestId || ""),
    agentId: String(record?.agentId || ""),
    operatorUserId: toNullableNumber(record?.operatorUserId),
    operatorUsername: String(record?.operatorUsername || ""),
    command: String(record?.command || ""),
    status: String(record?.status || ""),
    secureStatus: String(record?.secureStatus || ""),
    securityError: String(record?.securityError || ""),
    exitCode: toNullableNumber(record?.exitCode),
    error: summarizeErrorMessage(record),
    stdoutPreview: createCommandOutputPreview(stdout),
    stderrPreview: createCommandOutputPreview(stderr),
    stdoutChars,
    stderrChars,
    createdAt: record?.createdAt || null,
    updatedAt: record?.updatedAt || record?.createdAt || null,
    dispatchedAt: record?.dispatchedAt || null,
    startedAt: record?.startedAt || null,
    completedAt: record?.completedAt || null
  };
}

function summarizeErrorMessage(record) {
  const explicit = String(record?.error || "").trim();

  if (explicit) {
    return clampText(explicit, 4000);
  }

  const securityError = String(record?.securityError || "").trim();
  return clampText(securityError, 4000);
}

export function createCommandOutputPreview(text) {
  const value = String(text || "");

  if (!value) {
    return "";
  }

  const normalized = value.trim();

  if (normalized.length <= 4000) {
    return normalized;
  }

  const head = normalized.slice(0, 2000).trimEnd();
  const tail = normalized.slice(-1600).trimStart();
  return `${head}\n\n...[truncated ${normalized.length - 3600} chars]...\n\n${tail}`.slice(0, 4000);
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

function toCount(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback;
}

export function serializeStoredCommandRun(row) {
  return {
    requestId: row.request_id,
    agentId: row.agent_id,
    operatorUserId: row.operator_user_id ?? null,
    operatorUsername: row.operator_username || "",
    command: row.command_text || "",
    status: row.status || "",
    secureStatus: row.secure_status || "",
    securityError: row.security_error || "",
    exitCode: typeof row.exit_code === "number" ? row.exit_code : null,
    error: row.error_message || "",
    stdout: row.stdout_preview || "",
    stderr: row.stderr_preview || "",
    stdoutChars: Number(row.stdout_chars || 0),
    stderrChars: Number(row.stderr_chars || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    dispatchedAt: row.dispatched_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null
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
