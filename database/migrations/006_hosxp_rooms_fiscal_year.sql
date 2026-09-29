ALTER TABLE hosxp_appointments
 ADD COLUMN depcode VARCHAR(3) CHARACTER SET ascii NULL,
 ADD COLUMN doctor_code VARCHAR(40) NULL,
 ADD COLUMN doctor_name VARCHAR(255) NULL,
 ADD COLUMN fiscal_year SMALLINT UNSIGNED GENERATED ALWAYS AS
   (YEAR(appointment_date)+543+IF(MONTH(appointment_date)>=10,1,0)) STORED,
 ADD INDEX(fiscal_year,depcode,appointment_date);
