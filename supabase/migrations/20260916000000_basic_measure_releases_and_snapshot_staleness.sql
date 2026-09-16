alter table public.score_snapshots
  add column if not exists basics_sms_run_date date,
  add column if not exists basics_stale boolean not null default false;

comment on column public.score_snapshots.basics_sms_run_date is
  'FMCSA SMS run date the BASIC measure columns on this row came from. Null when unknown.';
comment on column public.score_snapshots.basics_stale is
  'True when the source BASIC data was older than the currentness window; BASIC measure columns on such rows must not be presented as current.';

create table if not exists public.basic_measure_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  dot_number text not null,
  sms_run_date date not null,
  source text not null check (source in ('qcmobile_basics', 'public_sms_profile', 'authenticated_all_basics')),
  source_url text,
  measures jsonb not null,
  captured_at timestamptz not null default now(),
  captured_by text not null,
  notes text,
  unique (client_id, sms_run_date, source)
);

comment on table public.basic_measure_releases is
  'One row per FMCSA SMS release of BASIC measures per client and source. Reports read BASIC scores only from here. measures keys: unsafe_driving, hos_compliance, driver_fitness, controlled_substance, vehicle_maintenance, hazmat_compliance, crash_indicator; each {measure, percentile, alert, inspections_with_violations} with null where not public.';

create index if not exists idx_basic_measure_releases_client_run
  on public.basic_measure_releases (client_id, sms_run_date desc);

alter table public.basic_measure_releases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'basic_measure_releases'
      and policyname = 'basic_measure_releases_staff'
  ) then
    create policy basic_measure_releases_staff on public.basic_measure_releases
      for all using (is_geia_staff()) with check (is_geia_staff());
  end if;
end
$$;
