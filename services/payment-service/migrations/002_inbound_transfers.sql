-- Credits arriving from other banks. rail_reference makes a rail retry harmless.
CREATE TABLE inbound_transfers (
  id                          uuid PRIMARY KEY,
  rail                        text NOT NULL CHECK (rail IN ('BIFAST', 'SKN')),
  rail_reference              text NOT NULL UNIQUE,
  sender_bank_code            text NOT NULL,
  sender_bank_name            text NOT NULL,
  sender_account_number       text NOT NULL,
  sender_name                 text NOT NULL,
  destination_account_number  text NOT NULL,
  amount                      numeric(20, 2) NOT NULL CHECK (amount > 0),
  description                 text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_destination_idx ON inbound_transfers (destination_account_number, created_at DESC);
