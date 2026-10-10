CREATE TABLE customers (
  cif            text PRIMARY KEY,
  username       text NOT NULL UNIQUE,
  full_name      text NOT NULL,
  email          text NOT NULL,
  phone          text NOT NULL,
  segment        text NOT NULL CHECK (segment IN ('REGULAR', 'PRIORITY', 'PRIVATE')),
  address        text NOT NULL,
  nik            text NOT NULL,
  birth_date     date NOT NULL,
  mfa_enabled    boolean NOT NULL DEFAULT false,
  password_hash  text NOT NULL,
  failed_logins  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cif                 text NOT NULL REFERENCES customers (cif),
  refresh_token_hash  text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE INDEX sessions_cif_idx ON sessions (cif);

CREATE TABLE mfa_challenges (
  token       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cif         text NOT NULL REFERENCES customers (cif),
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE onboarding_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type        text NOT NULL,
  full_name           text NOT NULL,
  email               text NOT NULL,
  phone               text NOT NULL,
  promotion_code      text,
  step                text NOT NULL DEFAULT 'started'
                      CHECK (step IN ('started', 'ekyc_submitted', 'submitted', 'approved', 'rejected')),
  nik                 text,
  birth_date          date,
  mother_maiden_name  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_step_idx ON onboarding_applications (step, created_at);

CREATE TABLE promotions (
  code          text PRIMARY KEY,
  title         text NOT NULL,
  product_type  text NOT NULL,
  valid_until   date NOT NULL
);

INSERT INTO promotions (code, title, product_type, valid_until) VALUES
  ('TABUNGAN-BARU-2026', 'Bunga 4,5% p.a. untuk Tabungan Nusa Harian baru', 'SAVINGS', '2026-12-31'),
  ('VALAS-USD-NOV', 'Kurs spesial pembukaan Tabungan Valas USD', 'SAVINGS', '2026-11-30'),
  ('DEPOSITO-12BLN', 'Deposito 12 bulan bunga 4,75% p.a.', 'TIME_DEPOSIT', '2026-12-31'),
  ('KARTU-PLATINUM', 'Bebas iuran tahunan pertama Kartu Kredit Nusa Platinum', 'CREDIT_CARD', '2027-01-31'),
  ('GIRO-UMKM', 'Giro Nusa Bisnis gratis biaya admin 6 bulan untuk UMKM', 'CURRENT', '2026-12-31');
