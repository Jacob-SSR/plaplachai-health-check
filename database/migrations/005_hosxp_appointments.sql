CREATE TABLE hosxp_appointments (
 oapp_id VARCHAR(64) CHARACTER SET ascii PRIMARY KEY,
 employee_id BIGINT UNSIGNED NOT NULL,
 appointment_date DATE NOT NULL, appointment_time TIME NULL, location VARCHAR(255) NOT NULL,
 source_status_id VARCHAR(40) NULL, fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
 schedule_version INT NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(employee_id) REFERENCES employees(id), INDEX(appointment_date)
);
CREATE TABLE hosxp_sync_state (
 id INT PRIMARY KEY, initialized BOOLEAN NOT NULL DEFAULT FALSE, last_success_at DATETIME(6) NULL
);
INSERT INTO hosxp_sync_state(id) VALUES(1);
ALTER TABLE notification_jobs MODIFY appointment_id BIGINT UNSIGNED NULL, MODIFY rule_id BIGINT UNSIGNED NULL,
 ADD COLUMN hosxp_oapp_id VARCHAR(64) CHARACTER SET ascii NULL,
 ADD CONSTRAINT fk_notification_hosxp FOREIGN KEY(hosxp_oapp_id) REFERENCES hosxp_appointments(oapp_id),
 ADD UNIQUE KEY uq_hosxp_notification(hosxp_oapp_id,schedule_version),
 ADD CONSTRAINT notification_source CHECK((appointment_id IS NULL) <> (hosxp_oapp_id IS NULL));
UPDATE notification_jobs SET status='CANCELLED',safe_error='เปลี่ยนไปใช้วันนัดจาก HOSxP'
 WHERE appointment_id IS NOT NULL AND status IN ('PENDING','BLOCKED');
