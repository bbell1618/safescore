-- Migration: 20260609_cpdp_par_confirmation
-- Adds human PAR-identity confirmation to cpdp_cases.
--
-- Root cause this fixes: FMCSA MCMIS crash numbers (e.g. OH0255151321) and
-- local law enforcement PAR report numbers (e.g. OHP 12-0837-12) are always
-- different numbering systems for the same crash. Without explicit instruction
-- the AI treated the divergence as a document-matching failure and returned
-- INSUFFICIENT EVIDENCE even when DOT/date/location all corroborated.
--
-- par_identity_confirmed: human has reviewed the PAR and confirmed it matches
--   this case. When TRUE the narrative prompt treats identity as resolved and
--   proceeds to full grounded generation.
-- par_confirmed_at:  timestamp of confirmation
-- par_confirmed_by:  identifier of confirming user (e.g. "geia")

ALTER TABLE cpdp_cases
  ADD COLUMN IF NOT EXISTS par_identity_confirmed  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS par_confirmed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS par_confirmed_by        TEXT;
