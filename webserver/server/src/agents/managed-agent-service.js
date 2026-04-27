import {
  createPublicKeyFingerprint,
  normalizeRsaPublicKeyPem
} from "../../../../shared/secure-command.mjs";

export class ManagedAgentService {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM managed_agents
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    );

    return rows[0] ? toManagedAgent(rows[0]) : null;
  }

  async findCurrentByAgentId(agentId) {
    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM managed_agents
        WHERE agent_id = ? AND record_status = 'current'
        ORDER BY id DESC
        LIMIT 1
      `,
      [String(agentId || "").trim()]
    );

    return rows[0] ? toManagedAgent(rows[0]) : null;
  }

  async list(options = {}) {
    const filters = ["1 = 1"];
    const values = [];
    const approvalStatus = String(options.approvalStatus || "").trim().toLowerCase();
    const recordStatus = String(options.recordStatus || "current").trim().toLowerCase();
    const isEnabled = normalizeOptionalBoolean(options.isEnabled);

    if (approvalStatus) {
      filters.push("approval_status = ?");
      values.push(approvalStatus);
    }

    if (recordStatus) {
      filters.push("record_status = ?");
      values.push(recordStatus);
    }

    if (typeof isEnabled === "boolean") {
      filters.push("is_enabled = ?");
      values.push(isEnabled ? 1 : 0);
    }

    const [rows] = await this.pool.execute(
      `
        SELECT *
        FROM managed_agents
        WHERE ${filters.join(" AND ")}
        ORDER BY
          CASE approval_status
            WHEN 'pending' THEN 0
            WHEN 'rejected' THEN 1
            ELSE 2
          END,
          last_seen_at DESC,
          id DESC
      `,
      values
    );

    return rows.map(toManagedAgent);
  }

  async createPendingRegistration(payload) {
    const normalized = normalizeManagedAgentRegistrationPayload(payload);
    const [result] = await this.pool.execute(
      `
        INSERT INTO managed_agents (
          agent_id,
          record_status,
          label,
          hostname,
          platform,
          arch,
          auth_public_key,
          auth_public_key_fingerprint,
          approval_status,
          is_enabled,
          application_note,
          review_comment,
          first_seen_at,
          last_seen_at,
          last_seen_ip
        )
        VALUES (?, 'current', ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?)
      `,
      [
        normalized.agentId,
        normalized.label,
        normalized.hostname,
        normalized.platform,
        normalized.arch,
        normalized.authPublicKey,
        normalized.authPublicKeyFingerprint,
        normalized.applicationNote,
        normalized.reviewComment,
        normalized.lastSeenIp
      ]
    );

    return this.findById(result.insertId);
  }

  async touchCurrentRegistration(recordId, payload) {
    const normalized = normalizeManagedAgentRegistrationPayload(payload);

    await this.pool.execute(
      `
        UPDATE managed_agents
        SET
          label = ?,
          hostname = ?,
          platform = ?,
          arch = ?,
          auth_public_key = ?,
          auth_public_key_fingerprint = ?,
          application_note = ?,
          last_seen_at = UTC_TIMESTAMP(),
          last_seen_ip = ?
        WHERE id = ?
      `,
      [
        normalized.label,
        normalized.hostname,
        normalized.platform,
        normalized.arch,
        normalized.authPublicKey,
        normalized.authPublicKeyFingerprint,
        normalized.applicationNote,
        normalized.lastSeenIp,
        recordId
      ]
    );

    return this.findById(recordId);
  }

  async createReverifyRegistration(currentRecordId, payload) {
    const normalized = normalizeManagedAgentRegistrationPayload(payload);
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.execute(
        `
          UPDATE managed_agents
          SET
            record_status = 'superseded',
            superseded_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
          WHERE id = ?
        `,
        [currentRecordId]
      );

      const [result] = await connection.execute(
        `
          INSERT INTO managed_agents (
            agent_id,
            record_status,
            label,
            hostname,
            platform,
            arch,
            auth_public_key,
            auth_public_key_fingerprint,
            approval_status,
            is_enabled,
            application_note,
            review_comment,
            first_seen_at,
            last_seen_at,
            last_seen_ip
          )
          VALUES (?, 'current', ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?)
        `,
        [
          normalized.agentId,
          normalized.label,
          normalized.hostname,
          normalized.platform,
          normalized.arch,
          normalized.authPublicKey,
          normalized.authPublicKeyFingerprint,
          normalized.applicationNote,
          normalized.reviewComment || "设备公钥指纹发生变化，待管理员复核",
          normalized.lastSeenIp
        ]
      );

      await connection.execute(
        `
          UPDATE managed_agents
          SET superseded_by_agent_record_id = ?
          WHERE id = ?
        `,
        [result.insertId, currentRecordId]
      );

      await connection.commit();
      return this.findById(result.insertId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async approve(id, actorUserId, reviewComment = "") {
    await this.pool.execute(
      `
        UPDATE managed_agents
        SET
          approval_status = 'approved',
          is_enabled = 1,
          approved_at = UTC_TIMESTAMP(),
          approved_by_user_id = ?,
          rejected_at = NULL,
          rejected_by_user_id = NULL,
          review_comment = ?
        WHERE id = ?
      `,
      [actorUserId ?? null, normalizeText(reviewComment, 255), id]
    );

    return this.findById(id);
  }

  async reject(id, actorUserId, reviewComment = "") {
    await this.pool.execute(
      `
        UPDATE managed_agents
        SET
          approval_status = 'rejected',
          rejected_at = UTC_TIMESTAMP(),
          rejected_by_user_id = ?,
          review_comment = ?
        WHERE id = ?
      `,
      [actorUserId ?? null, normalizeText(reviewComment, 255), id]
    );

    return this.findById(id);
  }

  async update(id, payload = {}) {
    const normalized = {
      label: normalizeText(payload.label, 128),
      applicationNote: normalizeText(payload.applicationNote, 255),
      reviewComment: normalizeText(payload.reviewComment, 255),
      isEnabled: payload.isEnabled !== false
    };

    await this.pool.execute(
      `
        UPDATE managed_agents
        SET
          label = ?,
          application_note = ?,
          review_comment = ?,
          is_enabled = ?
        WHERE id = ?
      `,
      [
        normalized.label,
        normalized.applicationNote,
        normalized.reviewComment,
        normalized.isEnabled ? 1 : 0,
        id
      ]
    );

    return this.findById(id);
  }
}

export function normalizeManagedAgentRegistrationPayload(payload = {}) {
  const agentId = String(payload.agentId || payload.agent_id || "").trim();
  const label = normalizeText(payload.label, 128);
  const hostname = normalizeText(payload.hostname, 255);
  const platform = normalizeText(payload.platform, 64);
  const arch = normalizeText(payload.arch, 64);
  const applicationNote = normalizeText(payload.applicationNote || payload.application_note, 255);
  const reviewComment = normalizeText(payload.reviewComment || payload.review_comment, 255);
  const lastSeenIp = normalizeText(payload.lastSeenIp || payload.last_seen_ip, 128);
  const rawAuthPublicKey = String(payload.authPublicKey || payload.auth_public_key || "").trim();
  const claimedFingerprint = String(
    payload.authPublicKeyFingerprint || payload.auth_public_key_fingerprint || ""
  )
    .trim()
    .toLowerCase();

  if (!agentId) {
    throw new Error("agentId 不能为空");
  }

  if (!rawAuthPublicKey) {
    throw new Error("设备公钥不能为空");
  }

  let authPublicKey;
  try {
    authPublicKey = `${normalizeRsaPublicKeyPem(rawAuthPublicKey)}\n`;
  } catch {
    throw new Error("设备公钥不是有效的 RSA 公钥 PEM");
  }

  const authPublicKeyFingerprint = createPublicKeyFingerprint(authPublicKey);

  if (claimedFingerprint && claimedFingerprint !== authPublicKeyFingerprint) {
    throw new Error("设备公钥指纹与公钥内容不匹配");
  }

  return {
    agentId,
    label: label || agentId,
    hostname,
    platform,
    arch,
    authPublicKey,
    authPublicKeyFingerprint,
    applicationNote,
    reviewComment,
    lastSeenIp
  };
}

function toManagedAgent(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    recordStatus: row.record_status,
    label: row.label || row.agent_id,
    hostname: row.hostname || "",
    platform: row.platform || "",
    arch: row.arch || "",
    authPublicKey: row.auth_public_key,
    authPublicKeyFingerprint: row.auth_public_key_fingerprint,
    approvalStatus: row.approval_status,
    isEnabled: Boolean(row.is_enabled),
    applicationNote: row.application_note || "",
    reviewComment: row.review_comment || "",
    approvedAt: row.approved_at || null,
    approvedByUserId: row.approved_by_user_id ?? null,
    rejectedAt: row.rejected_at || null,
    rejectedByUserId: row.rejected_by_user_id ?? null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    lastSeenIp: row.last_seen_ip || "",
    supersededAt: row.superseded_at || null,
    supersededByAgentRecordId: row.superseded_by_agent_record_id ?? null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
