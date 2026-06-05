-- Migration: 20260606_cpdp_ai_assessment
-- Adds AI eligibility assessment columns to cpdp_cases.
-- Populated automatically when the Police Accident Report (PAR) is uploaded.
-- ai_suggested_types  — the exact types the AI identified from the PAR (preserved even after human edits)
-- cpdp_eligible_types — the human-confirmed selection (may match or differ from ai_suggested_types)

ALTER TABLE cpdp_cases
  ADD COLUMN IF NOT EXISTS ai_assessed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_eligibility_verdict   TEXT,        -- 'ELIGIBLE' | 'INDETERMINATE' | 'NOT_ELIGIBLE'
  ADD COLUMN IF NOT EXISTS ai_eligibility_rationale TEXT,
  ADD COLUMN IF NOT EXISTS ai_suggested_types       TEXT[];
