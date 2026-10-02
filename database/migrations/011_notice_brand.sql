-- Show the logo and hospital name row on the LINE card header (Admin -> แจ้งเตือน -> ตั้งค่า).
ALTER TABLE notification_settings ADD COLUMN show_brand BOOLEAN NOT NULL DEFAULT TRUE;
