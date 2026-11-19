-- Operations can take an interbank rail out of service (EP2: Workflow Automation disables
-- BI FAST when its partner fails). No row, or auto_enable_at in the past, means available.
CREATE TABLE rail_availability (
  rail                text PRIMARY KEY CHECK (rail IN ('BIFAST', 'SKN')),
  available           boolean NOT NULL DEFAULT true,
  reason              text,
  changed_by          text NOT NULL,
  changed_at          timestamptz NOT NULL DEFAULT now(),
  unavailable_since   timestamptz,
  auto_enable_at      timestamptz
);
