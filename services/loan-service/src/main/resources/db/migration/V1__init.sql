-- Product terms are data so rates can change without a release. Fictional products.
CREATE TABLE loan_products (
  code                      text PRIMARY KEY CHECK (code IN ('KPR', 'KKB', 'KTA')),
  name                      text NOT NULL,
  interest_method           text NOT NULL CHECK (interest_method IN ('ANNUITY', 'FLAT')),
  fixed_rate                numeric(5, 2) NOT NULL,   -- annual %
  fixed_period_months       integer,                  -- ANNUITY: months at fixed_rate
  floating_rate             numeric(5, 2),            -- annual % after the fixed period
  min_principal             numeric(20, 2) NOT NULL,
  max_principal             numeric(20, 2) NOT NULL,
  min_tenor_months          integer NOT NULL,
  max_tenor_months          integer NOT NULL,
  min_down_payment_percent  integer,
  required_documents        text[] NOT NULL
);

INSERT INTO loan_products VALUES
  ('KPR', 'KPR Nusa Rumah Pertama', 'ANNUITY', 3.75, 36, 11.50, 100000000, 5000000000, 60, 360, 10,
   ARRAY['KTP', 'NPWP', 'SLIP_GAJI', 'SERTIFIKAT']),
  ('KKB', 'Kredit Kendaraan Nusa Mobil', 'FLAT', 4.25, NULL, NULL, 50000000, 1000000000, 12, 60, 20,
   ARRAY['KTP', 'SLIP_GAJI', 'SPK_DEALER']),
  ('KTA', 'KTA Nusa Cepat', 'FLAT', 11.88, NULL, NULL, 5000000, 300000000, 6, 60, NULL,
   ARRAY['KTP', 'SLIP_GAJI']);

CREATE TABLE loan_applications (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cif                          text NOT NULL,
  product_code                 text NOT NULL REFERENCES loan_products (code),
  status                       text NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED')),
  nik                          text NOT NULL,
  asset_price                  numeric(20, 2) NOT NULL,
  down_payment                 numeric(20, 2) NOT NULL DEFAULT 0,
  principal                    numeric(20, 2) NOT NULL,
  tenor_months                 integer NOT NULL,
  monthly_installment          numeric(20, 2) NOT NULL,
  monthly_income               numeric(20, 2) NOT NULL,
  employment_type              text,
  collateral_description       text,
  disbursement_account_number  text NOT NULL,
  credit_score                 integer,
  credit_grade                 text,
  existing_obligations         numeric(20, 2),
  credit_checked_at            timestamptz,
  decision_reason              text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  decided_at                   timestamptz,
  disbursed_at                 timestamptz
);
CREATE INDEX loan_applications_cif_idx ON loan_applications (cif, created_at DESC);
CREATE INDEX loan_applications_status_idx ON loan_applications (status, created_at DESC);

-- Uploaded files are kept small (2 MB cap) and stored inline: a demo, not a document store.
CREATE TABLE loan_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES loan_applications (id),
  document_type   text NOT NULL CHECK (document_type IN ('KTP', 'NPWP', 'SLIP_GAJI', 'REKENING_KORAN', 'SERTIFIKAT', 'SPK_DEALER')),
  file_name       text NOT NULL,
  content_type    text NOT NULL,
  size_bytes      integer NOT NULL,
  sha256          text NOT NULL,
  content         bytea NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loan_documents_application_idx ON loan_documents (application_id);
