-- Source of truth for money movement. Every journal balances per currency.
CREATE TABLE journals (
  id               uuid PRIMARY KEY,
  source_event_id  uuid NOT NULL UNIQUE,  -- makes every source event post exactly once
  source_topic     text NOT NULL,
  reference        text NOT NULL,
  posted_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journals_reference_idx ON journals (reference);

CREATE TABLE entries (
  id              bigserial PRIMARY KEY,
  journal_id      uuid NOT NULL REFERENCES journals (id),
  line            integer NOT NULL,
  gl_account      text NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount          numeric(20, 2) NOT NULL CHECK (amount > 0),
  currency        text NOT NULL,
  channel         text,
  description     text,
  hold_id         uuid,
  UNIQUE (journal_id, line)
);
CREATE INDEX entries_gl_account_idx ON entries (gl_account);
