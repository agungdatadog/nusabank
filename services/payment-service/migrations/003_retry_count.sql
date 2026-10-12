-- Operator retries (admin-service) of transfers that failed on an unavailable rail.
ALTER TABLE transfers ADD COLUMN retry_count integer NOT NULL DEFAULT 0;
-- The operations view lists all customers' transfers by time.
CREATE INDEX transfers_created_idx ON transfers (created_at DESC);
