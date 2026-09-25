CREATE TABLE standard_health_services (
 code VARCHAR(40) PRIMARY KEY, service_id BIGINT UNSIGNED NOT NULL UNIQUE,
 sort_order SMALLINT UNSIGNED NOT NULL,
 FOREIGN KEY(service_id) REFERENCES health_check_services(id)
);

INSERT INTO service_groups(code,name)
 SELECT 'PPC_DENTAL','ทันตกรรม' WHERE NOT EXISTS(SELECT 1 FROM service_groups WHERE name='ทันตกรรม');
INSERT INTO health_check_services(code,name,service_group_id)
 SELECT 'PPC_DENTAL','ทันตกรรม',g.id FROM service_groups g
 WHERE g.id=(SELECT MIN(id) FROM service_groups WHERE name='ทันตกรรม')
 AND NOT EXISTS(SELECT 1 FROM health_check_services s WHERE s.service_group_id=g.id AND s.name='ทันตกรรม');
INSERT INTO standard_health_services(code,service_id,sort_order)
 SELECT 'DENTAL',MIN(s.id),1 FROM health_check_services s JOIN service_groups g ON g.id=s.service_group_id
 WHERE s.name='ทันตกรรม' AND g.id=(SELECT MIN(id) FROM service_groups WHERE name='ทันตกรรม');

INSERT INTO service_groups(code,name)
 SELECT 'PPC_THAI','แผนไทย' WHERE NOT EXISTS(SELECT 1 FROM service_groups WHERE name='แผนไทย');
INSERT INTO health_check_services(code,name,service_group_id)
 SELECT 'PPC_THAI','แผนไทย',g.id FROM service_groups g
 WHERE g.id=(SELECT MIN(id) FROM service_groups WHERE name='แผนไทย')
 AND NOT EXISTS(SELECT 1 FROM health_check_services s WHERE s.service_group_id=g.id AND s.name='แผนไทย');
INSERT INTO standard_health_services(code,service_id,sort_order)
 SELECT 'THAI',MIN(s.id),2 FROM health_check_services s JOIN service_groups g ON g.id=s.service_group_id
 WHERE s.name='แผนไทย' AND g.id=(SELECT MIN(id) FROM service_groups WHERE name='แผนไทย');

INSERT INTO service_groups(code,name)
 SELECT 'PPC_PHYSICAL','กายภาพ' WHERE NOT EXISTS(SELECT 1 FROM service_groups WHERE name='กายภาพ');
INSERT INTO health_check_services(code,name,service_group_id)
 SELECT 'PPC_PHYSICAL','กายภาพ',g.id FROM service_groups g
 WHERE g.id=(SELECT MIN(id) FROM service_groups WHERE name='กายภาพ')
 AND NOT EXISTS(SELECT 1 FROM health_check_services s WHERE s.service_group_id=g.id AND s.name='กายภาพ');
INSERT INTO standard_health_services(code,service_id,sort_order)
 SELECT 'PHYSICAL',MIN(s.id),3 FROM health_check_services s JOIN service_groups g ON g.id=s.service_group_id
 WHERE s.name='กายภาพ' AND g.id=(SELECT MIN(id) FROM service_groups WHERE name='กายภาพ');

INSERT INTO service_groups(code,name)
 SELECT 'PPC_BLOOD','ตรวจเลือด' WHERE NOT EXISTS(SELECT 1 FROM service_groups WHERE name='ตรวจเลือด');
INSERT INTO health_check_services(code,name,service_group_id)
 SELECT 'PPC_BLOOD','ตรวจเลือด',g.id FROM service_groups g
 WHERE g.id=(SELECT MIN(id) FROM service_groups WHERE name='ตรวจเลือด')
 AND NOT EXISTS(SELECT 1 FROM health_check_services s WHERE s.service_group_id=g.id AND s.name='ตรวจเลือด');
INSERT INTO standard_health_services(code,service_id,sort_order)
 SELECT 'BLOOD',MIN(s.id),4 FROM health_check_services s JOIN service_groups g ON g.id=s.service_group_id
 WHERE s.name='ตรวจเลือด' AND g.id=(SELECT MIN(id) FROM service_groups WHERE name='ตรวจเลือด');

INSERT INTO health_check_plans(fiscal_year_id,code,name,location,start_date,end_date)
 SELECT y.id,CONCAT('PPC_FY_',y.fiscal_year),CONCAT('ตรวจสุขภาพบุคลากร ปี ',y.fiscal_year),'โรงพยาบาลพลับพลาชัย',y.start_date,y.end_date
 FROM fiscal_years y WHERE y.status='OPEN'
 AND NOT EXISTS(SELECT 1 FROM health_check_plans p WHERE p.code=CONCAT('PPC_FY_',y.fiscal_year));
INSERT IGNORE INTO plan_services(plan_id,service_id)
 SELECT p.id,d.service_id FROM fiscal_years y JOIN health_check_plans p ON p.fiscal_year_id=y.id AND p.code=CONCAT('PPC_FY_',y.fiscal_year)
 CROSS JOIN standard_health_services d WHERE y.status='OPEN';
