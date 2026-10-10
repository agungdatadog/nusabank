CREATE TABLE accounts (
  account_number  text PRIMARY KEY,
  cif             text NOT NULL,
  product_type    text NOT NULL CHECK (product_type IN ('SAVINGS', 'CURRENT', 'CREDIT_CARD', 'TIME_DEPOSIT', 'LOAN', 'INVESTMENT')),
  product_name    text NOT NULL,
  currency        text NOT NULL CHECK (currency IN ('IDR', 'USD', 'JPY')),
  -- For CREDIT_CARD, balance is the outstanding amount owed.
  balance         numeric(20, 2) NOT NULL,
  held            numeric(20, 2) NOT NULL DEFAULT 0 CHECK (held >= 0),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DORMANT', 'BLOCKED', 'CLOSED')),
  opened_at       date NOT NULL,
  interest_rate   numeric(5, 2),
  credit_limit    numeric(20, 2),
  maturity_date   date,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_cif_idx ON accounts (cif);

CREATE TABLE holds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number   text NOT NULL REFERENCES accounts (account_number),
  amount           numeric(20, 2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL,
  reference        text NOT NULL,
  purpose          text NOT NULL CHECK (purpose IN ('TRANSFER', 'BILL_PAYMENT')),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  idempotency_key  uuid NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX holds_active_idx ON holds (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number  text NOT NULL REFERENCES accounts (account_number),
  posted_at       timestamptz NOT NULL,
  type            text NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  amount          numeric(20, 2) NOT NULL,
  currency        text NOT NULL,
  description     text NOT NULL,
  channel         text NOT NULL,
  reference       text,
  balance_after   numeric(20, 2) NOT NULL,
  journal_id      uuid UNIQUE
);
CREATE INDEX transactions_account_posted_idx ON transactions (account_number, posted_at DESC);

-- ledger.posted.v1 is consumed at-least-once; this makes each event apply exactly once.
CREATE TABLE processed_events (
  event_id      uuid PRIMARY KEY,
  processed_at  timestamptz NOT NULL DEFAULT now()
);
