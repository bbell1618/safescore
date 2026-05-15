-- Onboarding data fields collected during client self-serve signup

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_contact_title   TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_types           TEXT[],
  ADD COLUMN IF NOT EXISTS operating_states        TEXT[],
  ADD COLUMN IF NOT EXISTS operating_radius        TEXT CHECK (operating_radius IN ('local', 'regional', 'otr')),
  ADD COLUMN IF NOT EXISTS service_agreement_accepted  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_agreement_date      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
