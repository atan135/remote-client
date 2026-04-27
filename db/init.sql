CREATE DATABASE IF NOT EXISTS `remote_client`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `remote_client`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'operator',
  `approval_status` VARCHAR(32) NOT NULL DEFAULT 'approved',
  `registration_source` VARCHAR(32) NOT NULL DEFAULT 'admin',
  `application_note` VARCHAR(255) NOT NULL DEFAULT '',
  `approved_at` DATETIME NULL,
  `approved_by_user_id` BIGINT UNSIGNED NULL,
  `rejected_at` DATETIME NULL,
  `rejected_by_user_id` BIGINT UNSIGNED NULL,
  `review_comment` VARCHAR(255) NOT NULL DEFAULT '',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`),
  KEY `idx_users_approval_status` (`approval_status`),
  KEY `idx_users_registration_source` (`registration_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `session_token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` VARCHAR(128) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_sessions_token_hash` (`session_token_hash`),
  KEY `idx_user_sessions_user_id` (`user_id`),
  KEY `idx_user_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_user_sessions_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_auth_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `agent_id` VARCHAR(128) NOT NULL,
  `auth_code` LONGTEXT NOT NULL,
  `remark` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_auth_codes_user_agent` (`user_id`, `agent_id`),
  UNIQUE KEY `uk_user_auth_codes_agent_id` (`agent_id`),
  KEY `idx_user_auth_codes_user_id` (`user_id`),
  CONSTRAINT `fk_user_auth_codes_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `managed_agents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id` VARCHAR(128) NOT NULL,
  `record_status` VARCHAR(32) NOT NULL DEFAULT 'current',
  `label` VARCHAR(128) NOT NULL DEFAULT '',
  `hostname` VARCHAR(255) NOT NULL DEFAULT '',
  `platform` VARCHAR(64) NOT NULL DEFAULT '',
  `arch` VARCHAR(64) NOT NULL DEFAULT '',
  `auth_public_key` LONGTEXT NOT NULL,
  `auth_public_key_fingerprint` CHAR(64) NOT NULL,
  `approval_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `application_note` VARCHAR(255) NOT NULL DEFAULT '',
  `review_comment` VARCHAR(255) NOT NULL DEFAULT '',
  `approved_at` DATETIME NULL,
  `approved_by_user_id` BIGINT UNSIGNED NULL,
  `rejected_at` DATETIME NULL,
  `rejected_by_user_id` BIGINT UNSIGNED NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_ip` VARCHAR(128) NOT NULL DEFAULT '',
  `superseded_at` DATETIME NULL,
  `superseded_by_agent_record_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_managed_agents_agent_id` (`agent_id`),
  KEY `idx_managed_agents_agent_record_status` (`agent_id`, `record_status`),
  KEY `idx_managed_agents_agent_review_status` (`agent_id`, `approval_status`, `is_enabled`),
  KEY `idx_managed_agents_key_fingerprint` (`auth_public_key_fingerprint`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `command_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` CHAR(36) NOT NULL,
  `agent_id` VARCHAR(128) NOT NULL,
  `operator_user_id` BIGINT UNSIGNED NULL,
  `operator_username` VARCHAR(64) NOT NULL DEFAULT '',
  `command_text` LONGTEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `secure_status` VARCHAR(64) NOT NULL DEFAULT '',
  `security_error` TEXT NOT NULL,
  `exit_code` INT NULL,
  `error_message` TEXT NOT NULL,
  `stdout_preview` MEDIUMTEXT NOT NULL,
  `stderr_preview` MEDIUMTEXT NOT NULL,
  `stdout_chars` INT UNSIGNED NOT NULL DEFAULT 0,
  `stderr_chars` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `dispatched_at` DATETIME NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_command_runs_request_id` (`request_id`),
  KEY `idx_command_runs_created_at` (`created_at`),
  KEY `idx_command_runs_agent_created` (`agent_id`, `created_at`),
  KEY `idx_command_runs_operator_created` (`operator_user_id`, `created_at`),
  CONSTRAINT `fk_command_runs_operator_user_id`
    FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `terminal_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` CHAR(36) NOT NULL,
  `request_id` CHAR(36) NOT NULL,
  `agent_id` VARCHAR(128) NOT NULL,
  `operator_user_id` BIGINT UNSIGNED NULL,
  `operator_username` VARCHAR(64) NOT NULL DEFAULT '',
  `profile` VARCHAR(128) NOT NULL,
  `session_type` VARCHAR(64) NOT NULL DEFAULT 'llm_cli',
  `display_mode` VARCHAR(32) NOT NULL DEFAULT 'terminal',
  `cwd` VARCHAR(1024) NOT NULL DEFAULT '',
  `status` VARCHAR(32) NOT NULL,
  `exit_code` INT NULL,
  `error_message` TEXT NOT NULL,
  `final_text` LONGTEXT NOT NULL,
  `final_text_chars` INT UNSIGNED NOT NULL DEFAULT 0,
  `raw_excerpt_tail` MEDIUMTEXT NOT NULL,
  `raw_char_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `started_at` DATETIME NULL,
  `last_output_at` DATETIME NULL,
  `closed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_terminal_sessions_session_id` (`session_id`),
  UNIQUE KEY `uk_terminal_sessions_request_id` (`request_id`),
  KEY `idx_terminal_sessions_created_at` (`created_at`),
  KEY `idx_terminal_sessions_agent_created` (`agent_id`, `created_at`),
  KEY `idx_terminal_sessions_operator_created` (`operator_user_id`, `created_at`),
  CONSTRAINT `fk_terminal_sessions_operator_user_id`
    FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `terminal_session_turns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` CHAR(36) NOT NULL,
  `turn_no` INT UNSIGNED NOT NULL,
  `input_text` LONGTEXT NOT NULL,
  `final_text` LONGTEXT NOT NULL,
  `extraction_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `raw_excerpt_tail` MEDIUMTEXT NOT NULL,
  `input_created_at` DATETIME NOT NULL,
  `finalized_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_terminal_session_turns_session_turn` (`session_id`, `turn_no`),
  KEY `idx_terminal_session_turns_session_created` (`session_id`, `created_at`),
  CONSTRAINT `fk_terminal_session_turns_session_id`
    FOREIGN KEY (`session_id`) REFERENCES `terminal_sessions` (`session_id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (
  `username`,
  `display_name`,
  `password_hash`,
  `role`,
  `approval_status`,
  `registration_source`,
  `approved_at`,
  `is_active`
)
SELECT
  'admin',
  'System Admin',
  'sha256$120000$70f3738d90a2372d328bdd1fc9992fbe$05bd2d2bdc6349c8fb919d2e71d01e79bab1593b59387f4c81b4b5754dd963d6',
  'admin',
  'approved',
  'system',
  UTC_TIMESTAMP(),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `username` = 'admin'
);

-- 默认登录账号：
-- username: admin
-- password: ChangeMe123!
-- 公开注册创建的新账号默认角色：operator
