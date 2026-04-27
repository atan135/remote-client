import {
  createPublicKeyFingerprint,
  normalizeRsaPublicKeyPem
} from "../../../../shared/secure-command.mjs";

export class AuthCodeService {
  constructor(pool) {
    this.pool = pool;
  }

  async listByUserId(userId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          user_id,
          agent_id,
          auth_code,
          remark,
          created_at,
          updated_at
        FROM user_auth_codes
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
      `,
      [userId]
    );

    return rows.map(toSafeAuthCode);
  }

  async listAll() {
    const [rows] = await this.pool.execute(
      `
        SELECT
          c.id,
          c.user_id,
          c.agent_id,
          c.auth_code,
          c.remark,
          c.created_at,
          c.updated_at,
          u.username,
          u.display_name
        FROM user_auth_codes c
        INNER JOIN users u ON u.id = c.user_id
        ORDER BY c.updated_at DESC, c.id DESC
      `
    );

    return rows.map((row) => ({
      ...toSafeAuthCode(row),
      ownerUsername: row.username,
      ownerDisplayName: row.display_name
    }));
  }

  async findByIdForUser(userId, id) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          user_id,
          agent_id,
          auth_code,
          remark,
          created_at,
          updated_at
        FROM user_auth_codes
        WHERE user_id = ? AND id = ?
        LIMIT 1
      `,
      [userId, id]
    );

    return rows[0] ? toSafeAuthCode(rows[0]) : null;
  }

  async findByUserIdAndAgentId(userId, agentId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          user_id,
          agent_id,
          auth_code,
          remark,
          created_at,
          updated_at
        FROM user_auth_codes
        WHERE user_id = ? AND agent_id = ?
        LIMIT 1
      `,
      [userId, agentId]
    );

    return rows[0] ? toSafeAuthCode(rows[0]) : null;
  }

  async findOwnerByAgentId(agentId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          c.id,
          c.user_id,
          c.agent_id,
          c.auth_code,
          c.remark,
          c.created_at,
          c.updated_at,
          u.username,
          u.display_name
        FROM user_auth_codes c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.agent_id = ?
        LIMIT 1
      `,
      [String(agentId || "").trim()]
    );

    return rows[0]
      ? {
          ...toSafeAuthCode(rows[0]),
          ownerUsername: rows[0].username,
          ownerDisplayName: rows[0].display_name
        }
      : null;
  }

  async create({ userId, agentId, authCode, remark, managedAgent = null }) {
    const normalized = normalizeAuthCodePayload({ agentId, authCode, remark });
    await this.assertBindableAgent(userId, normalized.agentId, managedAgent);
    const [result] = await this.pool.execute(
      `
        INSERT INTO user_auth_codes (
          user_id,
          agent_id,
          auth_code,
          remark
        )
        VALUES (?, ?, ?, ?)
      `,
      [userId, normalized.agentId, normalized.authCode, normalized.remark]
    );

    return this.findByIdForUser(userId, result.insertId);
  }

  async update(id, userId, { agentId, authCode, remark, managedAgent = null }) {
    const normalized = normalizeAuthCodePayload({ agentId, authCode, remark });
    await this.assertBindableAgent(userId, normalized.agentId, managedAgent, id);

    await this.pool.execute(
      `
        UPDATE user_auth_codes
        SET
          agent_id = ?,
          auth_code = ?,
          remark = ?
        WHERE id = ? AND user_id = ?
      `,
      [normalized.agentId, normalized.authCode, normalized.remark, id, userId]
    );

    return this.findByIdForUser(userId, id);
  }

  async assertBindableAgent(userId, agentId, managedAgent = null, ignoreAuthCodeId = null) {
    const normalizedAgentId = String(agentId || "").trim();

    if (!normalizedAgentId) {
      throw new Error("agentId 不能为空");
    }

    if (!managedAgent) {
      throw new Error("设备未通过审核，暂不允许绑定 auth_code");
    }

    if (String(managedAgent.approvalStatus || "") !== "approved" || managedAgent.isEnabled !== true) {
      throw new Error("设备未通过审核，暂不允许绑定 auth_code");
    }

    const owner = await this.findOwnerByAgentId(normalizedAgentId);

    if (!owner) {
      return;
    }

    if (ignoreAuthCodeId && Number(owner.id) === Number(ignoreAuthCodeId)) {
      return;
    }

    if (Number(owner.userId) !== Number(userId)) {
      throw new Error("该设备已被其他用户绑定 auth_code");
    }
  }

  async delete(id, userId) {
    const existing = await this.findByIdForUser(userId, id);

    if (!existing) {
      return null;
    }

    await this.pool.execute(
      "DELETE FROM user_auth_codes WHERE id = ? AND user_id = ?",
      [id, userId]
    );

    return existing;
  }

  async deleteAsAdmin(id) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          c.id,
          c.user_id,
          c.agent_id,
          c.auth_code,
          c.remark,
          c.created_at,
          c.updated_at,
          u.username,
          u.display_name
        FROM user_auth_codes c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!rows[0]) {
      return null;
    }

    await this.pool.execute("DELETE FROM user_auth_codes WHERE id = ?", [id]);

    return {
      ...toSafeAuthCode(rows[0]),
      ownerUsername: rows[0].username,
      ownerDisplayName: rows[0].display_name
    };
  }
}

export function normalizeAuthCodePayload({ agentId, authCode, remark }) {
  const normalizedAgentId = String(agentId || "").trim();
  const normalizedRemark = String(remark || "").trim().slice(0, 255);

  if (!normalizedAgentId) {
    throw new Error("agentId 不能为空");
  }

  const rawAuthCode = String(authCode || "").trim();

  if (!rawAuthCode) {
    throw new Error("auth_code 不能为空");
  }

  let normalizedAuthCode;
  try {
    normalizedAuthCode = normalizeRsaPublicKeyPem(rawAuthCode);
  } catch {
    throw new Error("auth_code 不是有效的 RSA 公钥 PEM");
  }

  return {
    agentId: normalizedAgentId,
    authCode: `${normalizedAuthCode}\n`,
    remark: normalizedRemark
  };
}

function toSafeAuthCode(row) {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    authCode: row.auth_code,
    remark: row.remark || "",
    fingerprint: createPublicKeyFingerprint(row.auth_code),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}
