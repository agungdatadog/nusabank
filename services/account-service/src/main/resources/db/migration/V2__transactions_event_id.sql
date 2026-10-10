-- One journal can touch the same account more than once (principal + fee, or both
-- sides of an intrabank transfer), so the dedupe key is the ledger.posted event id.
ALTER TABLE transactions DROP CONSTRAINT transactions_journal_id_key;
ALTER TABLE transactions ADD COLUMN event_id uuid UNIQUE;
CREATE INDEX transactions_journal_idx ON transactions (journal_id);
