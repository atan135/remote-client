import { verifyPassword } from "./password.js";

export class UserService {
  constructor(pool) {
    this.pool = pool;
  }

  async authenticate(username, password) {
    const [rows] = await this.pool.execute(
      `
        SELECT
          id,
          username,
          display_name,
          role,
          password_hash,
          is_active
        FROM users
        WHERE username = ?
        LIMIT 1
      `,
      [username]
    );

    const user = rows[0];

    if (!user || !user.is_active) {
      return null;
    }

    if (!verifyPassword(password, user.password_hash)) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    };
  }
}

