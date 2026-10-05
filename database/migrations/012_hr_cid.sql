-- CID from the HR register file (INFOMATION_PERSON.xlsx) is the recipient CID for notices.
-- Stored encrypted like employees.cid_ciphertext. cid_source='HR' marks a CID the HOSxP sync must not overwrite.
ALTER TABLE hr_personnel ADD COLUMN cid_ciphertext TEXT NULL;
ALTER TABLE employees ADD COLUMN cid_source VARCHAR(10) NULL
