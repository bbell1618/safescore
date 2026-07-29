-- Authoritative carrier-profile enrichment from public FMCSA sources.
-- Values stay source-scoped so a sparse source can never erase another
-- source's facts or the existing carrier_profiles census fields.

create table if not exists public.carrier_profile_enrichments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.clients(id) on delete cascade,
  source text not null
    check (
      source in (
        'safer_company_snapshot',
        'fmcsa_motus',
        'fmcsa_sms_inspections'
      )
    ),
  source_url text not null,
  source_as_of date,
  fetched_at timestamptz not null,
  currentness text not null default 'current'
    check (currentness in ('current', 'historical_only', 'no_data')),
  data jsonb not null
    check (jsonb_typeof(data) = 'object'),
  parser_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source)
);

create index if not exists idx_carrier_profile_enrichments_due
  on public.carrier_profile_enrichments (client_id, fetched_at desc);

alter table public.carrier_profile_enrichments enable row level security;

do $policies$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'carrier_profile_enrichments'
      and policyname = 'carrier_profile_enrichments_staff_read'
  ) then
    create policy carrier_profile_enrichments_staff_read
      on public.carrier_profile_enrichments
      for select
      to authenticated
      using ((select public.is_geia_staff()));
  end if;
end
$policies$;

revoke all privileges
  on table public.carrier_profile_enrichments
  from anon, authenticated;
grant select
  on table public.carrier_profile_enrichments
  to authenticated;
grant all privileges
  on table public.carrier_profile_enrichments
  to service_role;

do $triggers$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.carrier_profile_enrichments'::regclass
      and tgname = 'trg_carrier_profile_enrichments_updated_at'
      and not tgisinternal
  ) then
    create trigger trg_carrier_profile_enrichments_updated_at
      before update on public.carrier_profile_enrichments
      for each row execute function public.update_updated_at();
  end if;
end
$triggers$;

comment on table public.carrier_profile_enrichments is
  'Current, source-scoped public FMCSA carrier facts with provenance. A refresh replaces only the matching source row after full parser validation.';
comment on column public.carrier_profile_enrichments.source_as_of is
  'Date stated by the source, when published; null means the source exposes fetched-at only.';
comment on column public.carrier_profile_enrichments.data is
  'Normalized public fields only. Source and fetched_at on this row label every contained value.';
