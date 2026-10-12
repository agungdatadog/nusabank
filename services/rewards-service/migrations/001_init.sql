-- rewards-service owns database `rewards` on indowebinar-mysql-partner. Timestamps are UTC.

-- Every point movement. Earns are keyed by their source Kafka event, so a redelivered
-- event can never award points twice. REDEEM entries carry negative points.
CREATE TABLE entries (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  cif             VARCHAR(16)  NOT NULL,
  type            VARCHAR(8)   NOT NULL,
  points          INT          NOT NULL,
  description     VARCHAR(120) NOT NULL,
  reference       VARCHAR(64)  NULL,
  source_event_id CHAR(36)     NULL,
  idempotency_key CHAR(36)     NULL,
  voucher_code    VARCHAR(32)  NULL,
  created_at      DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_entries_source_event (source_event_id),
  UNIQUE KEY uq_entries_idempotency (cif, idempotency_key),
  KEY idx_entries_cif (cif, created_at)
);

-- Running balance per customer, updated in the same transaction as each entry.
CREATE TABLE balances (
  cif        VARCHAR(16) NOT NULL PRIMARY KEY,
  points     INT         NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
);
