BEGIN;
-- Preserve every existing challan; allow separate immutable shipments per job.
ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS dispatch_job_card_id_key;
DROP INDEX IF EXISTS ix_dispatch_job_card_id;
CREATE INDEX ix_dispatch_job_card_id ON dispatch (job_card_id);
COMMIT;
