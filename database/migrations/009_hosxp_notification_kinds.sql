ALTER TABLE notification_jobs
 ADD COLUMN kind ENUM('NEW','REMINDER','MANUAL') NOT NULL DEFAULT 'NEW',
 ADD COLUMN dedupe_key VARCHAR(64) CHARACTER SET ascii NOT NULL DEFAULT '',
 ADD COLUMN requested_by BIGINT UNSIGNED NULL,
 ADD UNIQUE KEY uq_hosxp_notification_kind(hosxp_oapp_id,schedule_version,kind,dedupe_key);
ALTER TABLE notification_jobs DROP INDEX uq_hosxp_notification;
UPDATE notification_rules SET active=0;
INSERT INTO notification_rules(days_before,active) VALUES(2,1) ON DUPLICATE KEY UPDATE active=1
