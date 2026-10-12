-- admin-service owns database `admin` on indowebinar-pg-channel.

-- Back-office operators. Seeded at startup with the shared demo password
-- (Secret Manager: indowebinar-demo-operator-password).
CREATE TABLE operators (
  username       text PRIMARY KEY,
  full_name      text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Every operator action, append-only: who did what to which target.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY,
  operator    text NOT NULL,
  action      text NOT NULL,
  target      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
