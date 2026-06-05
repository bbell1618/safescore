-- CPDP submission builder: new columns + evidence table
-- Applied 2026-06-05

ALTER TABLE cpdp_cases
  ADD COLUMN IF NOT EXISTS cpdp_eligible_types         TEXT[],
  ADD COLUMN IF NOT EXISTS case_number                 TEXT,
  ADD COLUMN IF NOT EXISTS filed_without_evidence      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_reason             TEXT,
  ADD COLUMN IF NOT EXISTS narrative_evidence_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS narrative_verified_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS narrative_verified_by       TEXT;

-- CPDP evidence table (mirrors dataq_evidence; FK → cpdp_cases)
CREATE TABLE IF NOT EXISTS cpdp_evidence (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        UUID        NOT NULL REFERENCES cpdp_cases(id) ON DELETE CASCADE,
  doc_type       TEXT        NOT NULL,
  label          TEXT        NOT NULL,
  context_note   TEXT,
  fmcsa_category TEXT,
  required       BOOLEAN     NOT NULL DEFAULT FALSE,
  status         TEXT        NOT NULL DEFAULT 'requested'
                             CHECK (status IN ('requested', 'received')),
  storage_path   TEXT,
  uploaded_at    TIMESTAMPTZ,
  uploaded_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cpdp_evidence_case_id_idx ON cpdp_evidence(case_id);

-- Storage: CPDP evidence files are stored in the existing dataq-evidence bucket
-- under the path prefix cpdp-cases/{caseId}/{evidId}/{filename}
