-- Operations can take a biller out of service (EP2: Digital Channels switches GoPay off during
-- a partner outage). No row, or auto_enable_at in the past, means available.
CREATE TABLE biller_availability (
  biller_code       VARCHAR(32)  NOT NULL PRIMARY KEY,
  available         BOOLEAN      NOT NULL DEFAULT TRUE,
  reason            VARCHAR(200) NULL,
  changed_by        VARCHAR(64)  NOT NULL,
  changed_at        DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  unavailable_since DATETIME(3)  NULL,
  auto_enable_at    DATETIME(3)  NULL
);
