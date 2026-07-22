-- A material metric change can occur after an earlier snapshot on the same day.
-- Preserve both point-in-time rows so monitoring and reports retain the before/after.
alter table public.burden_snapshots
  drop constraint if exists burden_snapshots_client_date_uniq;

create index if not exists burden_snapshots_client_date_captured_idx
  on public.burden_snapshots (client_id, snapshot_date desc, captured_at desc, id desc);
