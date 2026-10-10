CREATE TABLE inquiries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cif                         text NOT NULL,
  rail                        text NOT NULL CHECK (rail IN ('INTRABANK', 'BIFAST', 'SKN')),
  source_account_number       text NOT NULL,
  source_account_name         text NOT NULL,
  destination_bank_code       text NOT NULL,
  destination_bank_name       text NOT NULL,
  destination_account_number  text NOT NULL,
  destination_account_name    text NOT NULL,
  amount                      numeric(20, 2) NOT NULL CHECK (amount > 0),
  fee                         numeric(20, 2) NOT NULL,
  expires_at                  timestamptz NOT NULL,
  used_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfers (
  id                          uuid PRIMARY KEY,
  cif                         text NOT NULL,
  inquiry_id                  uuid NOT NULL UNIQUE REFERENCES inquiries (id),
  idempotency_key             uuid NOT NULL UNIQUE,
  rail                        text NOT NULL,
  status                      text NOT NULL CHECK (status IN ('PROCESSING', 'SUCCESS', 'FAILED')),
  source_account_number       text NOT NULL,
  source_account_name         text NOT NULL,
  destination_bank_code       text NOT NULL,
  destination_bank_name       text NOT NULL,
  destination_account_number  text NOT NULL,
  destination_account_name    text NOT NULL,
  amount                      numeric(20, 2) NOT NULL,
  fee                         numeric(20, 2) NOT NULL,
  note                        text,
  hold_id                     uuid,
  rail_reference              text UNIQUE,
  skn_window_id               text,
  failure_reason              text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  settled_at                  timestamptz
);
CREATE INDEX transfers_cif_created_idx ON transfers (cif, created_at DESC);
CREATE INDEX transfers_status_idx ON transfers (status, created_at DESC);

CREATE TABLE beneficiaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cif             text NOT NULL,
  bank_code       text NOT NULL,
  bank_name       text NOT NULL,
  account_number  text NOT NULL,
  account_name    text NOT NULL,
  alias           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cif, bank_code, account_number)
);

-- Transactional outbox: an event is committed with the state change that caused it,
-- so a Kafka hiccup can delay a ledger posting but never lose one.
CREATE TABLE outbox (
  id          bigserial PRIMARY KEY,
  topic       text NOT NULL,
  msg_key     text NOT NULL,
  payload     jsonb NOT NULL,
  carrier     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbox_unsent_idx ON outbox (created_at) WHERE sent_at IS NULL;
