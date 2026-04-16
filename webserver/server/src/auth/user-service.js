import { hashPassword, verifyPassword } from "./password.js";

export class UserService {
  constructor(pool) {
    this.pool = pool;
  }

  async authenticate(username, password) {
    const user = await this.findUserWithPasswordByUsername(username);

    if (!user || !user.is_active) {
      return null;
    }

    if (!verifyPassword(password, user.password_hash)) {
      return null;
    }

    return toSafeUser(user);
  }

  async register({ username, displayName, password, role = "operator" }) {
    const passwordHash = hashPassword(password);

    const [result] = await this.pool.execute(
      `
        INSERT INTO users (
          username,
          display_name,
          password_hash,
          role,
          is_active
        )
        VALUES (?, ?, ?, ?, 1)
      `,
      [username, displayName, passwordHash, role]
    );

    return this.findUserById(result.insertId);
  }

  async createUser({ username, displayName, password, role, isActive }) {
    const passwordHash = hashPassword(password);

    const [result] = await this.pool.execute(
      `
        INSERT INTO users (
          username,
          display_name,
          password_hash,
          role,
          is_active
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [username, displayName, passwordHash, role, isActive ? 1 : 0]
    );

    return this.findUserById(result.insertId);
  }

  async listUsers() {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          is_active,
          created_at,
          updated_at
        FROM users
        ORDER BY created_at DESC
      `
    );

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

  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.findUserWithPasswordById(userId);

    if (!user || !user.is_active) {
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
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}
