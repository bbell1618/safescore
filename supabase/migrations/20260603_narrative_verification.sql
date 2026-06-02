ALTER TABLE dataq_cases
  ADD COLUMN IF NOT EXISTS narrative_evidence_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS narrative_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS narrative_verified_by TEXT;
