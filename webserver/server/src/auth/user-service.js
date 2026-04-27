import { hashPassword, verifyPassword } from "./password.js";

export class UserService {
  constructor(pool) {
    this.pool = pool;
  }

  async authenticate(username, password) {
    const user = await this.findUserWithPasswordByUsername(username);

    if (!user) {
      return { ok: false, reason: "invalid_credentials" };
    }

    if (!verifyPassword(password, user.password_hash)) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const approvalStatus = normalizeApprovalStatus(user.approval_status);

    if (approvalStatus === "pending") {
      return { ok: false, reason: "pending" };
    }

    if (approvalStatus === "rejected") {
      return { ok: false, reason: "rejected" };
    }

    if (!user.is_active) {
      return { ok: false, reason: "disabled" };
    }

    return {
      ok: true,
      user: toSafeUser(user)
    };
  }

  async register({
    username,
    displayName,
    password,
    role = "operator",
    approvalStatus = "approved",
    registrationSource = "admin",
    applicationNote = "",
    approvedByUserId = null
  }) {
    return this.createUser({
      username,
      displayName,
      password,
      role,
      isActive: true,
      approvalStatus,
      registrationSource,
      applicationNote,
      approvedByUserId
    });
  }

  async createUser({
    username,
    displayName,
    password,
    role,
    isActive,
    approvalStatus = "approved",
    registrationSource = "admin",
    applicationNote = "",
    approvedByUserId = null
  }) {
    const passwordHash = hashPassword(password);
    const normalizedApprovalStatus = normalizeApprovalStatus(approvalStatus);
    const normalizedRegistrationSource = normalizeRegistrationSource(registrationSource);
    const normalizedApplicationNote = normalizeText(applicationNote, 255);
    const approvedAt = normalizedApprovalStatus === "approved" ? createTimestamp() : null;

    const [result] = await this.pool.execute(
      `
        INSERT INTO users (
          username,
          display_name,
          password_hash,
          role,
          approval_status,
          registration_source,
          application_note,
          approved_at,
          approved_by_user_id,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        username,
        displayName,
        passwordHash,
        role,
        normalizedApprovalStatus,
        normalizedRegistrationSource,
        normalizedApplicationNote,
        approvedAt,
        approvedByUserId,
        isActive ? 1 : 0
      ]
    );

    return this.findUserById(result.insertId);
  }

  async listUsers() {
    const [rows] = await this.pool.execute(`
      SELECT
        id,
        username,
        display_name,
        role,
        approval_status,
        registration_source,
        application_note,
        approved_at,
        approved_by_user_id,
        rejected_at,
        rejected_by_user_id,
        review_comment,
        is_active,
        created_at,
        updated_at
      FROM users
      ORDER BY
        CASE approval_status
          WHEN 'pending' THEN 0
          WHEN 'rejected' THEN 1
          ELSE 2
        END,
        created_at DESC
    `);

    return rows.map(toSafeUser);
  }

  async findUserById(userId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          approval_status,
          registration_source,
          application_note,
          approved_at,
          approved_by_user_id,
          rejected_at,
          rejected_by_user_id,
          review_comment,
          is_active,
          created_at,
          updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    return rows[0] ? toSafeUser(rows[0]) : null;
  }

  async findUserByUsername(username) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          approval_status,
          registration_source,
          application_note,
          approved_at,
          approved_by_user_id,
          rejected_at,
          rejected_by_user_id,
          review_comment,
          is_active,
          created_at,
          updated_at
        FROM users
        WHERE username = ?
        LIMIT 1
      `,
      [username]
    );

    return rows[0] ? toSafeUser(rows[0]) : null;
  }

  async usernameExists(username) {
    const [rows] = await this.pool.execute(
      "SELECT 1 FROM users WHERE username = ? LIMIT 1",
      [username]
    );

    return rows.length > 0;
  }

  async updateUser(userId, { displayName, role, isActive }) {
    await this.pool.execute(
      `
        UPDATE users
        SET
          display_name = ?,
          role = ?,
          is_active = ?
        WHERE id = ?
      `,
      [displayName, role, isActive ? 1 : 0, userId]
    );

    return this.findUserById(userId);
  }

  async approveUser(userId, actorUserId, reviewComment = "") {
    await this.pool.execute(
      `
        UPDATE users
        SET
          approval_status = 'approved',
          is_active = 1,
          approved_at = UTC_TIMESTAMP(),
          approved_by_user_id = ?,
          rejected_at = NULL,
          rejected_by_user_id = NULL,
          review_comment = ?
        WHERE id = ?
      `,
      [actorUserId ?? null, normalizeText(reviewComment, 255), userId]
    );

    return this.findUserById(userId);
  }

  async rejectUser(userId, actorUserId, reviewComment = "") {
    await this.pool.execute(
      `
        UPDATE users
        SET
          approval_status = 'rejected',
          rejected_at = UTC_TIMESTAMP(),
          rejected_by_user_id = ?,
          review_comment = ?
        WHERE id = ?
      `,
      [actorUserId ?? null, normalizeText(reviewComment, 255), userId]
    );

    return this.findUserById(userId);
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.findUserWithPasswordById(userId);

    if (!user || !user.is_active || normalizeApprovalStatus(user.approval_status) !== "approved") {
      return { ok: false, reason: "not_found" };
    }

    if (!verifyPassword(currentPassword, user.password_hash)) {
      return { ok: false, reason: "invalid_password" };
    }

    await this.setPassword(userId, newPassword);
    return { ok: true };
  }

  async adminSetPassword(userId, newPassword) {
    await this.setPassword(userId, newPassword);
    return this.findUserById(userId);
  }

  async setPassword(userId, password) {
    const passwordHash = hashPassword(password);

    await this.pool.execute(
      `
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
      `,
      [passwordHash, userId]
    );
  }

  async findUserWithPasswordByUsername(username) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          approval_status,
          registration_source,
          application_note,
          approved_at,
          approved_by_user_id,
          rejected_at,
          rejected_by_user_id,
          review_comment,
          password_hash,
          is_active,
          created_at,
          updated_at
        FROM users
        WHERE username = ?
        LIMIT 1
      `,
      [username]
    );

    return rows[0] || null;
  }

  async findUserWithPasswordById(userId) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          approval_status,
          registration_source,
          application_note,
          approved_at,
          approved_by_user_id,
          rejected_at,
          rejected_by_user_id,
          review_comment,
          password_hash,
          is_active,
          created_at,
          updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    return rows[0] || null;
  }
}

function toSafeUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    approvalStatus: normalizeApprovalStatus(row.approval_status),
    registrationSource: normalizeRegistrationSource(row.registration_source),
    applicationNote: row.application_note || "",
    approvedAt: row.approved_at || null,
    approvedByUserId: row.approved_by_user_id ?? null,
    rejectedAt: row.rejected_at || null,
    rejectedByUserId: row.rejected_by_user_id ?? null,
    reviewComment: row.review_comment || "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeApprovalStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized) ? normalized : "approved";
}

function normalizeRegistrationSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "admin";
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function createTimestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
