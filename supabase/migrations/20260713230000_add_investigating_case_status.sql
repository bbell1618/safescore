-- The deployed INVESTIGATE workflow writes this pre-filing review state.
-- Additive and idempotent; no existing case status is changed.
alter type public.case_status add value if not exists 'investigating' before 'filed';
