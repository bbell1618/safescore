-- Lock the two pre-regulatory legacy backup tables out of the Data API.
-- Service-role/Postgres access remains available for controlled audit reads.
-- The preserved bak_ns_*_20260625 regulatory archive is intentionally untouched.
alter table if exists public.inspections_backup_20260617 enable row level security;
alter table if exists public.violations_backup_20260617 enable row level security;
