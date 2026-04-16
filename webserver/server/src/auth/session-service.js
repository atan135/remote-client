import crypto from "node:crypto";

export class SessionService {
  constructor(pool, config) {
    this.pool = pool;
    this.config = config;
  }

  async createSession({ userId, ipAddress, userAgent }) {
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(sessionToken);
    const expiresAt = createExpiresAt(this.config.sessionTtlHours);

    const [result] = await this.pool.execute(
      `
        INSERT INTO user_sessions (
          user_id,
          session_token_hash,
          expires_at,
          ip_address,
          user_agent
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [userId, tokenHash, expiresAt, ipAddress, userAgent]
    );

    return {
      sessionId: result.insertId,
      sessionToken,
      expiresAt
    };
  }

  async getSessionByToken(sessionToken) {
    if (!sessionToken) {
      return null;
    }

    const tokenHash = sha256(sessionToken);
    const [rows] = await this.pool.execute(
      `
        SELECT
          s.id,
          s.user_id,
          s.expires_at,
          u.username,
          u.display_name,
          u.role,
          u.is_active
        FROM user_sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.session_token_hash = ?
          AND s.expires_at > UTC_TIMESTAMP()
          AND u.is_active = 1
        LIMIT 1
      `,
      [tokenHash]
    );

    return rows[0] || null;
  }

  async touchSession(sessionId) {
    const expiresAt = createExpiresAt(this.config.sessionTtlHours);

    await this.pool.execute(
      `
        UPDATE user_sessions
        SET expires_at = ?, last_seen_at = UTC_TIMESTAMP()
        WHERE id = ?
      `,
      [expiresAt, sessionId]
    );

    return expiresAt;
  }

  async deleteSession(sessionToken) {
    if (!sessionToken) {
      return;
    }

    await this.pool.execute(
      "DELETE FROM user_sessions WHERE session_token_hash = ?",
      [sha256(sessionToken)]
    );
  }

  async deleteSessionsByUserId(userId) {
    await this.pool.execute(
      "DELETE FROM user_sessions WHERE user_id = ?",
      [userId]
    );
  }

  async purgeExpiredSessions() {
    await this.pool.execute(
      "DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP()"
    );
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createExpiresAt(hours) {
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  return expiresAt.toISOString().slice(0, 19).replace("T", " ");
}
