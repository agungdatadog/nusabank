-- Lockouts expire: a lock with no recent failure shouldn't keep a demo customer out forever.
ALTER TABLE customers ADD COLUMN last_failed_login_at timestamptz;
