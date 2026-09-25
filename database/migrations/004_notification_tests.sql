CREATE TABLE notification_test_sends (
 id CHAR(36) PRIMARY KEY,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 employee_id BIGINT UNSIGNED NOT NULL,
 status ENUM('SENDING','ACCEPTED','FAILED','UNKNOWN','BLOCKED') NOT NULL,
 http_status SMALLINT UNSIGNED NULL,
 provider_code VARCHAR(3) NULL,
 safe_error VARCHAR(500) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 finished_at DATETIME(6) NULL,
 FOREIGN KEY(actor_user_id) REFERENCES users(id),
 FOREIGN KEY(employee_id) REFERENCES employees(id),
 INDEX(employee_id,created_at)
);
