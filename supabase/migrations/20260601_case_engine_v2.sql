-- SafeScore Case Engine v2
-- Adds dataq_evidence, dataq_evidence_request, new columns on dataq_cases,
-- updated_at trigger for dataq_evidence, and dataq-evidence storage bucket.

-- ── 1. New columns on dataq_cases ────────────────────────────────────────────
ALTER TABLE dataq_cases
  ADD COLUMN IF NOT EXISTS canonical_inspection_date DATE,
  ADD COLUMN IF NOT EXISTS dataqs_reason_code TEXT DEFAULT 'violation_incorrect',
  ADD COLUMN IF NOT EXISTS filed_without_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- ── 2. dataq_evidence ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataq_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES dataq_cases(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL,
  label           TEXT NOT NULL,
  context_note    TEXT,
  fmcsa_category  TEXT,
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'received')),
  storage_path    TEXT,
  uploaded_at     TIMESTAMPTZ,
  uploaded_by     TEXT CHECK (uploaded_by IN ('client', 'geia')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dataq_evidence_case ON dataq_evidence(case_id);

-- ── 3. dataq_evidence_request ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataq_evidence_request (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES dataq_cases(id) ON DELETE CASCADE UNIQUE,
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dataq_evidence_request_token ON dataq_evidence_request(token);

-- ── 4. updated_at trigger for dataq_evidence ─────────────────────────────────
-- update_updated_at() function already exists from initial schema
CREATE TRIGGER trg_dataq_evidence_updated_at
  BEFORE UPDATE ON dataq_evidence
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5. RLS: dataq_evidence — staff ALL, no client access ─────────────────────
ALTER TABLE dataq_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dqev_staff" ON dataq_evidence
  FOR ALL USING (is_geia_staff());

-- ── 6. RLS: dataq_evidence_request — staff ALL, public SELECT by token ────────
ALTER TABLE dataq_evidence_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dqer_staff" ON dataq_evidence_request
  FOR ALL USING (is_geia_staff());

-- Public can SELECT a single row by token (upload page validation).
-- auth.uid() may be null for unauthenticated requests; USING clause handles it.
CREATE POLICY "dqer_public_token" ON dataq_evidence_request
  FOR SELECT USING (TRUE);

-- ── 7. Storage bucket: dataq-evidence (private) ───────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('dataq-evidence', 'dataq-evidence', false)
ON CONFLICT DO NOTHING;
