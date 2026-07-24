-- U8: MCS-150 truth-up loop foundation.
-- Attested values are deliberately separate from clients.driver_count, which remains
-- the operator-editable billing source of truth.

alter table public.carrier_profiles
  add column if not exists operation_classification text,
  add column if not exists physical_address text,
  add column if not exists mailing_address text;

comment on column public.carrier_profiles.operation_classification is
  'Operating classifications parsed from the public FMCSA SAFER company snapshot.';
comment on column public.carrier_profiles.physical_address is
  'Physical address parsed from the public FMCSA SAFER company snapshot.';
comment on column public.carrier_profiles.mailing_address is
  'Mailing address parsed from the public FMCSA SAFER company snapshot.';

create table if not exists public.client_attested_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique
    references public.clients(id) on delete cascade,
  power_units integer
    check (power_units >= 0),
  drivers integer
    check (drivers >= 0),
  annual_mileage bigint
    check (annual_mileage >= 0),
  mileage_year integer
    check (mileage_year between 1900 and 2100),
  operation_classification text,
  cargo_types text[] not null default array[]::text[],
  physical_address text,
  mailing_address text,
  officials jsonb not null default '[]'::jsonb
    check (jsonb_typeof(officials) = 'array'),
  source text not null default 'census_default'
    check (source in ('census_default', 'operator_recorded')),
  attested_at timestamptz,
  attested_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_attested_profiles_attested_at
  on public.client_attested_profiles (attested_at desc);

alter table public.client_attested_profiles enable row level security;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_attested_profiles'
      and policyname = 'client_attested_profiles_read'
  ) then
    create policy client_attested_profiles_read
      on public.client_attested_profiles
      for select
      to authenticated
      using (
        client_id = (select public.get_user_client_id())
        or (select public.is_geia_staff())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_attested_profiles'
      and policyname = 'client_attested_profiles_staff_insert'
  ) then
    create policy client_attested_profiles_staff_insert
      on public.client_attested_profiles
      for insert
      to authenticated
      with check ((select public.is_geia_staff()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_attested_profiles'
      and policyname = 'client_attested_profiles_staff_update'
  ) then
    create policy client_attested_profiles_staff_update
      on public.client_attested_profiles
      for update
      to authenticated
      using ((select public.is_geia_staff()))
      with check ((select public.is_geia_staff()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_attested_profiles'
      and policyname = 'client_attested_profiles_staff_delete'
  ) then
    create policy client_attested_profiles_staff_delete
      on public.client_attested_profiles
      for delete
      to authenticated
      using ((select public.is_geia_staff()));
  end if;
end
$policies$;

revoke all privileges on table public.client_attested_profiles from anon;
revoke all privileges on table public.client_attested_profiles from authenticated;
grant select, insert, update, delete
  on table public.client_attested_profiles to authenticated;
grant all privileges
  on table public.client_attested_profiles to service_role;

alter table public.mcs150_updates
  add column if not exists client_request_id uuid,
  add column if not exists trigger_key text,
  add column if not exists trigger_reasons jsonb,
  add column if not exists census_snapshot jsonb,
  add column if not exists attested_snapshot jsonb,
  add column if not exists honesty_prediction jsonb,
  add column if not exists biennial_due_date date,
  add column if not exists last_checked_at timestamptz,
  add column if not exists confirmed_census_snapshot jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_client_request_id_fkey'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_client_request_id_fkey
      foreign key (client_request_id)
      references public.client_requests(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_trigger_reasons_array_check'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_trigger_reasons_array_check
      check (
        trigger_reasons is null
        or jsonb_typeof(trigger_reasons) = 'array'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_census_snapshot_object_check'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_census_snapshot_object_check
      check (
        census_snapshot is null
        or jsonb_typeof(census_snapshot) = 'object'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_attested_snapshot_object_check'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_attested_snapshot_object_check
      check (
        attested_snapshot is null
        or jsonb_typeof(attested_snapshot) = 'object'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_honesty_prediction_object_check'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_honesty_prediction_object_check
      check (
        honesty_prediction is null
        or jsonb_typeof(honesty_prediction) = 'object'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mcs150_updates'::regclass
      and conname = 'mcs150_updates_confirmed_census_snapshot_object_check'
  ) then
    alter table public.mcs150_updates
      add constraint mcs150_updates_confirmed_census_snapshot_object_check
      check (
        confirmed_census_snapshot is null
        or jsonb_typeof(confirmed_census_snapshot) = 'object'
      ) not valid;
  end if;
end
$constraints$;

alter table public.mcs150_updates
  validate constraint mcs150_updates_trigger_reasons_array_check;
alter table public.mcs150_updates
  validate constraint mcs150_updates_census_snapshot_object_check;
alter table public.mcs150_updates
  validate constraint mcs150_updates_attested_snapshot_object_check;
alter table public.mcs150_updates
  validate constraint mcs150_updates_honesty_prediction_object_check;
alter table public.mcs150_updates
  validate constraint mcs150_updates_confirmed_census_snapshot_object_check;

create unique index if not exists idx_mcs150_updates_active_trigger
  on public.mcs150_updates (client_id, trigger_key)
  where trigger_key is not null
    and status in ('draft', 'pending_review', 'submitted');

create index if not exists idx_mcs150_updates_client_request
  on public.mcs150_updates (client_request_id)
  where client_request_id is not null;

do $triggers$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.client_attested_profiles'::regclass
      and tgname = 'trg_client_attested_profiles_updated_at'
      and not tgisinternal
  ) then
    create trigger trg_client_attested_profiles_updated_at
      before update on public.client_attested_profiles
      for each row execute function public.update_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.mcs150_updates'::regclass
      and tgname = 'trg_mcs150_updates_updated_at'
      and not tgisinternal
  ) then
    create trigger trg_mcs150_updates_updated_at
      before update on public.mcs150_updates
      for each row execute function public.update_updated_at();
  end if;
end
$triggers$;

comment on table public.client_attested_profiles is
  'Carrier-attested operating facts used for MCS-150 truth-up comparisons; separate from billing truth on clients.';
comment on column public.client_attested_profiles.source is
  'census_default until an operator records an attestation; operator_recorded thereafter.';
comment on column public.mcs150_updates.honesty_prediction is
  'Deterministic predicted burden-per-power-unit and utilization direction shown before carrier submission.';
comment on column public.mcs150_updates.confirmed_census_snapshot is
  'Public census values that closed the loop by matching the proposed figures.';
