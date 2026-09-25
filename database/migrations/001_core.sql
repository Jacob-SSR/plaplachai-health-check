CREATE TABLE hospitals (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(10) NOT NULL UNIQUE,
 name VARCHAR(200) NOT NULL, timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok'
) ENGINE=InnoDB;
CREATE TABLE users (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, username VARCHAR(100) NOT NULL UNIQUE,
 display_name VARCHAR(200) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, auth_version INT NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE);
CREATE TABLE permissions (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(80) NOT NULL UNIQUE);
CREATE TABLE user_roles (
 user_id BIGINT UNSIGNED NOT NULL, role_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(user_id,role_id),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(role_id) REFERENCES roles(id)
);
CREATE TABLE role_permissions (
 role_id BIGINT UNSIGNED NOT NULL, permission_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(role_id,permission_id),
 FOREIGN KEY(role_id) REFERENCES roles(id), FOREIGN KEY(permission_id) REFERENCES permissions(id)
);
CREATE TABLE user_sessions (
 token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
 csrf_token VARCHAR(64) CHARACTER SET ascii NOT NULL, auth_version INT NOT NULL,
 expires_at DATETIME(6) NOT NULL, last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(user_id) REFERENCES users(id), INDEX(expires_at)
);
CREATE TABLE login_limits (
 bucket CHAR(64) CHARACTER SET ascii PRIMARY KEY, attempts INT NOT NULL, reset_at DATETIME(6) NOT NULL
);
CREATE TABLE departments (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL, parent_id BIGINT UNSIGNED NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1,
 FOREIGN KEY(parent_id) REFERENCES departments(id)
);
CREATE TABLE positions (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1
);
CREATE TABLE position_levels (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1
);
CREATE TABLE employment_types (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1
);
CREATE TABLE user_department_scopes (
 user_id BIGINT UNSIGNED NOT NULL, department_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(user_id,department_id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(department_id) REFERENCES departments(id)
);
CREATE TABLE employees (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, employee_code VARCHAR(40) NOT NULL UNIQUE,
 prefix VARCHAR(30) NOT NULL DEFAULT '', first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL,
 cid_ciphertext TEXT NULL, cid_hmac CHAR(64) CHARACTER SET ascii NULL UNIQUE,
 cid_verified_at DATETIME(6) NULL, notification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE employee_assignments (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, employee_id BIGINT UNSIGNED NOT NULL,
 department_id BIGINT UNSIGNED NOT NULL, position_id BIGINT UNSIGNED NOT NULL,
 level_id BIGINT UNSIGNED NULL, employment_type_id BIGINT UNSIGNED NULL,
 valid_from DATE NOT NULL, valid_to DATE NULL,
 FOREIGN KEY(employee_id) REFERENCES employees(id), FOREIGN KEY(department_id) REFERENCES departments(id),
 FOREIGN KEY(position_id) REFERENCES positions(id), FOREIGN KEY(level_id) REFERENCES position_levels(id),
 FOREIGN KEY(employment_type_id) REFERENCES employment_types(id),
 UNIQUE(employee_id,valid_from), CHECK(valid_to IS NULL OR valid_to > valid_from)
);
CREATE TABLE fiscal_years (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, fiscal_year SMALLINT UNSIGNED NOT NULL UNIQUE,
 start_date DATE NOT NULL, end_date DATE NOT NULL, status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
 version INT NOT NULL DEFAULT 1,
 CHECK(fiscal_year BETWEEN 2500 AND 2800), CHECK(start_date < end_date),
 CHECK(YEAR(start_date)=fiscal_year-544 AND MONTH(start_date)=10 AND DAY(start_date)=1),
 CHECK(YEAR(end_date)=fiscal_year-543 AND MONTH(end_date)=9 AND DAY(end_date)=30)
);
CREATE TABLE fiscal_year_members (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, fiscal_year_id BIGINT UNSIGNED NOT NULL,
 employee_id BIGINT UNSIGNED NOT NULL, assignment_id BIGINT UNSIGNED NOT NULL,
 department_id BIGINT UNSIGNED NOT NULL, display_name VARCHAR(255) NOT NULL,
 department_name VARCHAR(255) NOT NULL, position_name VARCHAR(255) NOT NULL, snapshot_date DATE NOT NULL,
 eligibility_status ENUM('ELIGIBLE','EXCLUDED') NOT NULL DEFAULT 'ELIGIBLE', exclusion_reason VARCHAR(500) NULL,
 FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id), FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(assignment_id) REFERENCES employee_assignments(id), FOREIGN KEY(department_id) REFERENCES departments(id),
 UNIQUE(fiscal_year_id,employee_id), UNIQUE(id,fiscal_year_id), INDEX(fiscal_year_id,department_id)
);
CREATE TABLE health_check_plans (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, fiscal_year_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, location VARCHAR(255) NOT NULL,
 start_date DATE NOT NULL, end_date DATE NOT NULL, status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
 version INT NOT NULL DEFAULT 1, FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id),
 UNIQUE(id,fiscal_year_id), CHECK(start_date <= end_date)
);
CREATE TABLE service_groups (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(150) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1
);
CREATE TABLE health_check_services (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, service_group_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1,
 FOREIGN KEY(service_group_id) REFERENCES service_groups(id), UNIQUE(id,service_group_id)
);
CREATE TABLE plan_services (
 plan_id BIGINT UNSIGNED NOT NULL, service_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(plan_id,service_id),
 FOREIGN KEY(plan_id) REFERENCES health_check_plans(id), FOREIGN KEY(service_id) REFERENCES health_check_services(id)
);
CREATE TABLE member_service_requirements (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, member_id BIGINT UNSIGNED NOT NULL,
 plan_id BIGINT UNSIGNED NOT NULL, fiscal_year_id BIGINT UNSIGNED NOT NULL,
 service_id BIGINT UNSIGNED NOT NULL, round_no SMALLINT UNSIGNED NOT NULL,
 status ENUM('REQUIRED','EXEMPT') NOT NULL DEFAULT 'REQUIRED', reason VARCHAR(500) NULL,
 FOREIGN KEY(member_id,fiscal_year_id) REFERENCES fiscal_year_members(id,fiscal_year_id),
 FOREIGN KEY(plan_id,fiscal_year_id) REFERENCES health_check_plans(id,fiscal_year_id),
 FOREIGN KEY(plan_id,service_id) REFERENCES plan_services(plan_id,service_id),
 UNIQUE(member_id,plan_id,service_id,round_no), UNIQUE(id,member_id,plan_id,service_id,round_no), CHECK(round_no>0)
);
CREATE TABLE health_check_appointments (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, appointment_code VARCHAR(50) NOT NULL UNIQUE,
 member_id BIGINT UNSIGNED NOT NULL, plan_id BIGINT UNSIGNED NOT NULL, fiscal_year_id BIGINT UNSIGNED NOT NULL,
 service_group_id BIGINT UNSIGNED NOT NULL, round_no SMALLINT UNSIGNED NOT NULL, attempt_no SMALLINT UNSIGNED NOT NULL DEFAULT 1,
 appointment_date DATE NOT NULL, appointment_time TIME NOT NULL, queue_label VARCHAR(50) NOT NULL DEFAULT '',
 location VARCHAR(255) NOT NULL, status ENUM('SCHEDULED','CHECKED_IN','COMPLETED','NO_SHOW','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
 note VARCHAR(1000) NOT NULL DEFAULT '', change_reason VARCHAR(500) NOT NULL DEFAULT '',
 identity_snapshot JSON NOT NULL, version INT NOT NULL DEFAULT 1, schedule_version INT NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(member_id,fiscal_year_id) REFERENCES fiscal_year_members(id,fiscal_year_id),
 FOREIGN KEY(plan_id,fiscal_year_id) REFERENCES health_check_plans(id,fiscal_year_id),
 FOREIGN KEY(service_group_id) REFERENCES service_groups(id), FOREIGN KEY(created_by) REFERENCES users(id),
 UNIQUE(plan_id,member_id,service_group_id,round_no,attempt_no),
 UNIQUE(id,member_id,plan_id,service_group_id,round_no),
 INDEX(fiscal_year_id,appointment_date,status), INDEX(member_id,appointment_date),
 CHECK(round_no>0 AND attempt_no>0), CHECK(appointment_time >= '00:00:00' AND appointment_time < '24:00:00')
);
CREATE TABLE appointment_services (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, appointment_id BIGINT UNSIGNED NOT NULL,
 member_id BIGINT UNSIGNED NOT NULL, plan_id BIGINT UNSIGNED NOT NULL, service_group_id BIGINT UNSIGNED NOT NULL,
 service_id BIGINT UNSIGNED NOT NULL, requirement_id BIGINT UNSIGNED NOT NULL, round_no SMALLINT UNSIGNED NOT NULL,
 service_name VARCHAR(150) NOT NULL, status ENUM('PENDING','DONE','NOT_DONE','CANCELLED') NOT NULL DEFAULT 'PENDING',
 performed_at DATETIME(6) NULL, performed_by BIGINT UNSIGNED NULL, performed_snapshot JSON NULL,
 FOREIGN KEY(appointment_id,member_id,plan_id,service_group_id,round_no)
  REFERENCES health_check_appointments(id,member_id,plan_id,service_group_id,round_no),
 FOREIGN KEY(service_id,service_group_id) REFERENCES health_check_services(id,service_group_id),
 FOREIGN KEY(requirement_id,member_id,plan_id,service_id,round_no)
  REFERENCES member_service_requirements(id,member_id,plan_id,service_id,round_no),
 FOREIGN KEY(performed_by) REFERENCES users(id), UNIQUE(appointment_id,service_id),
 CHECK(status <> 'DONE' OR (performed_at IS NOT NULL AND performed_by IS NOT NULL AND performed_snapshot IS NOT NULL))
);
CREATE TABLE result_definitions (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, service_id BIGINT UNSIGNED NOT NULL,
 definition_version INT NOT NULL, schema_json JSON NOT NULL,
 status ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT',
 FOREIGN KEY(service_id) REFERENCES health_check_services(id), UNIQUE(service_id,definition_version)
);
CREATE TABLE health_check_results (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, appointment_service_id BIGINT UNSIGNED NOT NULL,
 revision INT NOT NULL, status ENUM('PENDING','FINAL','INCOMPLETE','VOID') NOT NULL,
 result_reference VARCHAR(255) NULL, definition_id BIGINT UNSIGNED NULL, payload_ciphertext MEDIUMTEXT NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(appointment_service_id) REFERENCES appointment_services(id), FOREIGN KEY(definition_id) REFERENCES result_definitions(id),
 FOREIGN KEY(created_by) REFERENCES users(id), UNIQUE(appointment_service_id,revision)
);
CREATE TABLE import_batches (
 id CHAR(36) CHARACTER SET ascii PRIMARY KEY, fiscal_year_id BIGINT UNSIGNED NOT NULL, plan_id BIGINT UNSIGNED NOT NULL,
 filename VARCHAR(255) NOT NULL, file_sha256 CHAR(64) NOT NULL, preview_digest CHAR(64) NOT NULL,
 status ENUM('READY','INVALID','COMMITTED','EXPIRED') NOT NULL,
 total_rows INT NOT NULL, valid_rows INT NOT NULL, invalid_rows INT NOT NULL, success_rows INT NOT NULL DEFAULT 0,
 imported_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NOT NULL,
 FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id), FOREIGN KEY(plan_id) REFERENCES health_check_plans(id),
 FOREIGN KEY(imported_by) REFERENCES users(id), CHECK(total_rows=valid_rows+invalid_rows)
);
CREATE TABLE import_rows (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, batch_id CHAR(36) CHARACTER SET ascii NOT NULL,
 source_row INT NOT NULL, payload JSON NOT NULL,
 FOREIGN KEY(batch_id) REFERENCES import_batches(id), UNIQUE(batch_id,source_row)
);
CREATE TABLE import_errors (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, batch_id CHAR(36) CHARACTER SET ascii NOT NULL,
 source_row INT NOT NULL, field VARCHAR(80) NOT NULL, message VARCHAR(1000) NOT NULL,
 FOREIGN KEY(batch_id) REFERENCES import_batches(id)
);
CREATE TABLE master_aliases (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, source_name VARCHAR(100) NOT NULL,
 source_value VARCHAR(255) NOT NULL, department_id BIGINT UNSIGNED NULL, position_id BIGINT UNSIGNED NULL,
 FOREIGN KEY(department_id) REFERENCES departments(id), FOREIGN KEY(position_id) REFERENCES positions(id),
 UNIQUE(source_name,source_value), CHECK((department_id IS NULL) <> (position_id IS NULL))
);
CREATE TABLE notification_settings (
 id INT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, mode ENUM('DRY_RUN','LIVE') NOT NULL DEFAULT 'DRY_RUN',
 send_local_time TIME NOT NULL DEFAULT '08:00:00', version INT NOT NULL DEFAULT 1
);
CREATE TABLE notification_rules (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, days_before SMALLINT UNSIGNED NOT NULL UNIQUE,
 active BOOLEAN NOT NULL DEFAULT TRUE, CHECK(days_before <= 365)
);
CREATE TABLE notification_jobs (
 id CHAR(36) CHARACTER SET ascii PRIMARY KEY, appointment_id BIGINT UNSIGNED NOT NULL,
 schedule_version INT NOT NULL, rule_id BIGINT UNSIGNED NOT NULL,
 status ENUM('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN','CANCELLED','BLOCKED','DRY_RUN') NOT NULL DEFAULT 'PENDING',
 scheduled_at DATETIME(6) NOT NULL, available_at DATETIME(6) NOT NULL,
 lease_until DATETIME(6) NULL, attempt_count INT NOT NULL DEFAULT 0, safe_error VARCHAR(500) NULL,
 accepted_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(appointment_id) REFERENCES health_check_appointments(id), FOREIGN KEY(rule_id) REFERENCES notification_rules(id),
 UNIQUE(appointment_id,schedule_version,rule_id), INDEX(status,available_at)
);
CREATE TABLE notification_attempts (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, job_id CHAR(36) CHARACTER SET ascii NOT NULL,
 attempt_no INT NOT NULL, outcome VARCHAR(20) NOT NULL, http_status INT NULL, provider_code VARCHAR(40) NULL,
 safe_error VARCHAR(500) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(job_id) REFERENCES notification_jobs(id), UNIQUE(job_id,attempt_no)
);
CREATE TABLE audit_logs (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, actor_user_id BIGINT UNSIGNED NULL,
 action VARCHAR(80) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id VARCHAR(80) NULL,
 changes JSON NULL, request_id CHAR(36) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(actor_user_id) REFERENCES users(id), INDEX(entity_type,entity_id,created_at)
);
