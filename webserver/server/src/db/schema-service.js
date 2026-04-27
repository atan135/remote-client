export class SchemaService {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureApprovalSchema() {
    await this.ensureUsersApprovalColumns();
    const authCodeOwnership = await this.ensureUserAuthCodesOwnershipIndexes();
    await this.ensureManagedAgentsTable();
    await this.ensureAdminApprovalDefaults();
    return authCodeOwnership;
  }

  async ensureUsersApprovalColumns() {
    await this.ensureColumn(
      "users",
      "approval_status",
      "ALTER TABLE `users` ADD COLUMN `approval_status` VARCHAR(32) NOT NULL DEFAULT 'approved' AFTER `role`"
    );
    await this.ensureColumn(
      "users",
      "registration_source",
      "ALTER TABLE `users` ADD COLUMN `registration_source` VARCHAR(32) NOT NULL DEFAULT 'admin' AFTER `approval_status`"
    );
    await this.ensureColumn(
      "users",
      "application_note",
      "ALTER TABLE `users` ADD COLUMN `application_note` VARCHAR(255) NOT NULL DEFAULT '' AFTER `registration_source`"
    );
    await this.ensureColumn(
      "users",
      "approved_at",
      "ALTER TABLE `users` ADD COLUMN `approved_at` DATETIME NULL AFTER `application_note`"
    );
    await this.ensureColumn(
      "users",
      "approved_by_user_id",
      "ALTER TABLE `users` ADD COLUMN `approved_by_user_id` BIGINT UNSIGNED NULL AFTER `approved_at`"
    );
    await this.ensureColumn(
      "users",
      "rejected_at",
      "ALTER TABLE `users` ADD COLUMN `rejected_at` DATETIME NULL AFTER `approved_by_user_id`"
    );
    await this.ensureColumn(
      "users",
      "rejected_by_user_id",
      "ALTER TABLE `users` ADD COLUMN `rejected_by_user_id` BIGINT UNSIGNED NULL AFTER `rejected_at`"
    );
    await this.ensureColumn(
      "users",
      "review_comment",
      "ALTER TABLE `users` ADD COLUMN `review_comment` VARCHAR(255) NOT NULL DEFAULT '' AFTER `rejected_by_user_id`"
    );
    await this.ensureIndex(
      "users",
      "idx_users_approval_status",
      "ALTER TABLE `users` ADD KEY `idx_users_approval_status` (`approval_status`)"
    );
    await this.ensureIndex(
      "users",
      "idx_users_registration_source",
      "ALTER TABLE `users` ADD KEY `idx_users_registration_source` (`registration_source`)"
    );
  }

  async ensureUserAuthCodesOwnershipIndexes() {
    await this.ensureIndex(
      "user_auth_codes",
      "idx_user_auth_codes_agent_id",
      "ALTER TABLE `user_auth_codes` ADD KEY `idx_user_auth_codes_agent_id` (`agent_id`)"
    );

    if (await this.indexExists("user_auth_codes", "uk_user_auth_codes_agent_id")) {
      return { ok: true, duplicateAgents: [] };
    }

    const [duplicateRows] = await this.pool.query(`
      SELECT agent_id, COUNT(*) AS duplicate_count
      FROM user_auth_codes
      GROUP BY agent_id
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, agent_id ASC
      LIMIT 10
    `);

    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      return {
        ok: false,
        duplicateAgents: duplicateRows.map((row) => String(row.agent_id || ""))
      };
    }

    await this.pool.query(
      "ALTER TABLE `user_auth_codes` ADD UNIQUE KEY `uk_user_auth_codes_agent_id` (`agent_id`)"
    );

    return { ok: true, duplicateAgents: [] };
  }

  async ensureManagedAgentsTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS \`managed_agents\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`agent_id\` VARCHAR(128) NOT NULL,
        \`record_status\` VARCHAR(32) NOT NULL DEFAULT 'current',
        \`label\` VARCHAR(128) NOT NULL DEFAULT '',
        \`hostname\` VARCHAR(255) NOT NULL DEFAULT '',
        \`platform\` VARCHAR(64) NOT NULL DEFAULT '',
        \`arch\` VARCHAR(64) NOT NULL DEFAULT '',
        \`auth_public_key\` LONGTEXT NOT NULL,
        \`auth_public_key_fingerprint\` CHAR(64) NOT NULL,
        \`approval_status\` VARCHAR(32) NOT NULL DEFAULT 'pending',
        \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`application_note\` VARCHAR(255) NOT NULL DEFAULT '',
        \`review_comment\` VARCHAR(255) NOT NULL DEFAULT '',
        \`approved_at\` DATETIME NULL,
        \`approved_by_user_id\` BIGINT UNSIGNED NULL,
        \`rejected_at\` DATETIME NULL,
        \`rejected_by_user_id\` BIGINT UNSIGNED NULL,
        \`first_seen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`last_seen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`last_seen_ip\` VARCHAR(128) NOT NULL DEFAULT '',
        \`superseded_at\` DATETIME NULL,
        \`superseded_by_agent_record_id\` BIGINT UNSIGNED NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_managed_agents_agent_id\` (\`agent_id\`),
        KEY \`idx_managed_agents_agent_record_status\` (\`agent_id\`, \`record_status\`),
        KEY \`idx_managed_agents_agent_review_status\` (\`agent_id\`, \`approval_status\`, \`is_enabled\`),
        KEY \`idx_managed_agents_key_fingerprint\` (\`auth_public_key_fingerprint\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async ensureAdminApprovalDefaults() {
    await this.pool.query(`
      UPDATE users
      SET
        approval_status = 'approved',
        registration_source = CASE
          WHEN registration_source = '' THEN 'system'
          ELSE registration_source
        END,
        approved_at = COALESCE(approved_at, UTC_TIMESTAMP())
      WHERE username = 'admin'
    `);
  }

  async ensureColumn(tableName, columnName, alterSql) {
    if (await this.columnExists(tableName, columnName)) {
      return false;
    }

    await this.pool.query(alterSql);
    return true;
  }

  async ensureIndex(tableName, indexName, alterSql) {
    if (await this.indexExists(tableName, indexName)) {
      return false;
    }

    await this.pool.query(alterSql);
    return true;
  }

  async columnExists(tableName, columnName) {
    const [rows] = await this.pool.query(
      `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
      [columnName]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async indexExists(tableName, indexName) {
    const [rows] = await this.pool.query(
      `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
      [indexName]
    );
    return Array.isArray(rows) && rows.length > 0;
  }
}
