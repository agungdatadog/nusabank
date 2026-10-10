-- biller-service owns database `biller` on indowebinar-mysql-partner. Amounts are whole
-- rupiah (BIGINT): every biller product is IDR-only. Timestamps are UTC.

CREATE TABLE inquiries (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  cif              VARCHAR(16)  NOT NULL,
  biller_code      VARCHAR(32)  NOT NULL,
  category         VARCHAR(16)  NOT NULL,
  customer_number  VARCHAR(20)  NOT NULL,
  customer_name    VARCHAR(120) NOT NULL,
  product_code     VARCHAR(32)  NULL,
  product_name     VARCHAR(80)  NULL,
  period           VARCHAR(16)  NULL,
  amount           BIGINT       NOT NULL,
  fee              BIGINT       NOT NULL,
  biller_reference VARCHAR(40)  NULL,
  expires_at       DATETIME(3)  NOT NULL,
  used_at          DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  KEY idx_inquiries_cif (cif, created_at)
);

CREATE TABLE payments (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  cif                   VARCHAR(16)  NOT NULL,
  idempotency_key       CHAR(36)     NOT NULL,
  inquiry_id            CHAR(36)     NOT NULL,
  biller_code           VARCHAR(32)  NOT NULL,
  biller_name           VARCHAR(80)  NOT NULL,
  category              VARCHAR(16)  NOT NULL,
  customer_number       VARCHAR(20)  NOT NULL,
  customer_name         VARCHAR(120) NOT NULL,
  product_code          VARCHAR(32)  NULL,
  product_name          VARCHAR(80)  NULL,
  period                VARCHAR(16)  NULL,
  source_account_number CHAR(16)     NOT NULL,
  amount                BIGINT       NOT NULL,
  fee                   BIGINT       NOT NULL,
  -- SUCCESS | FAILED | PENDING. PENDING covers "in flight" and "biller timed out".
  status                VARCHAR(8)   NOT NULL,
  hold_id               CHAR(36)     NULL,
  biller_reference      VARCHAR(40)  NULL,
  token                 VARCHAR(32)  NULL,
  failure_reason        VARCHAR(40)  NULL,
  attempts              INT          NOT NULL DEFAULT 0,
  created_at            DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at            DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  UNIQUE KEY uq_payments_idempotency (cif, idempotency_key),
  UNIQUE KEY uq_payments_inquiry (inquiry_id),
  KEY idx_payments_cif (cif, created_at),
  KEY idx_payments_pending (status, updated_at)
);

-- Transactional outbox: the event is written with the payment's final state, so a
-- Kafka outage can never leave a paid bill without its ledger debit.
CREATE TABLE outbox (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  topic      VARCHAR(64) NOT NULL,
  msg_key    VARCHAR(64) NOT NULL,
  payload    MEDIUMTEXT  NOT NULL,
  carrier    TEXT        NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  sent_at    DATETIME(3) NULL,
  KEY idx_outbox_unsent (sent_at, id)
);
