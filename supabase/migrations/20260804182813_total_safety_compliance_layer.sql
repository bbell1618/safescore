-- U9 Total Safety compliance layer.
-- Extend the original compliance tables; never derive clients.driver_count or billing
-- values from the operational driver roster.

alter type public.driver_doc_type add value if not exists 'prior_employer_checks';
alter type public.driver_doc_type add value if not exists 'annual_mvr_review';
alter type public.driver_doc_type add value if not exists 'clearinghouse_pre_employment';

alter table public.drivers
  add column if not exists cdl_class text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.driver_documents
  add column if not exists completed_date date,
  add column if not exists updated_at timestamptz not null default now();

alter table public.vehicles
  add column if not exists annual_inspection_date date,
  add column if not exists updated_at timestamptz not null default now();

alter table public.vehicle_maintenance
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.client_compliance_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique
    references public.clients(id) on delete cascade,
  clearinghouse_registration_status text not null default 'unknown'
    check (clearinghouse_registration_status in ('unknown', 'registered', 'not_registered')),
  clearinghouse_registration_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_expiration_digests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  digest_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  event_count integer not null default 0 check (event_count >= 0),
  delivery_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(delivery_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, digest_date)
);

create table if not exists public.compliance_expiration_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  item_type text not null check (
    item_type in (
      'medical_certificate',
      'cdl',
      'annual_vehicle_inspection',
      'annual_mvr_review',
      'clearinghouse_annual_query'
    )
  ),
  subject_type text not null
    check (subject_type in ('driver', 'driver_document', 'vehicle')),
  subject_id uuid not null,
  due_date date not null,
  threshold text not null
    check (threshold in ('60_day', '30_day', '7_day', 'expired')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  digest_id uuid references public.compliance_expiration_digests(id) on delete set null,
  alert_id uuid references public.alerts(id) on delete set null,
  client_request_id uuid references public.client_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, item_type, subject_id, due_date, threshold)
);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_maintenance'::regclass
      and conname = 'vehicle_maintenance_type_check'
  ) then
    alter table public.vehicle_maintenance
      add constraint vehicle_maintenance_type_check
      check (maintenance_type in ('pm_service', 'repair', 'annual_inspection'))
      not valid;
  end if;
end
$constraints$;

alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_type_check;

-- Composite keys prevent a child row from naming one client's driver/vehicle/document
-- while carrying another client's client_id.
create unique index if not exists drivers_id_client_unique
  on public.drivers(id, client_id);
create unique index if not exists vehicles_id_client_unique
  on public.vehicles(id, client_id);
create unique index if not exists documents_id_client_unique
  on public.documents(id, client_id);
create unique index if not exists alerts_id_client_unique
  on public.alerts(id, client_id);
create unique index if not exists client_requests_id_client_unique
  on public.client_requests(id, client_id);
create unique index if not exists compliance_expiration_digests_id_client_unique
  on public.compliance_expiration_digests(id, client_id);

do $tenant_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_documents'::regclass
      and conname = 'driver_documents_driver_client_fkey'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_driver_client_fkey
      foreign key (driver_id, client_id)
      references public.drivers(id, client_id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_documents'::regclass
      and conname = 'driver_documents_document_client_fkey'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_document_client_fkey
      foreign key (document_id, client_id)
      references public.documents(id, client_id)
      on delete set null (document_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_maintenance'::regclass
      and conname = 'vehicle_maintenance_vehicle_client_fkey'
  ) then
    alter table public.vehicle_maintenance
      add constraint vehicle_maintenance_vehicle_client_fkey
      foreign key (vehicle_id, client_id)
      references public.vehicles(id, client_id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_maintenance'::regclass
      and conname = 'vehicle_maintenance_document_client_fkey'
  ) then
    alter table public.vehicle_maintenance
      add constraint vehicle_maintenance_document_client_fkey
      foreign key (document_id, client_id)
      references public.documents(id, client_id)
      on delete set null (document_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clearinghouse_records'::regclass
      and conname = 'clearinghouse_records_driver_client_fkey'
  ) then
    alter table public.clearinghouse_records
      add constraint clearinghouse_records_driver_client_fkey
      foreign key (driver_id, client_id)
      references public.drivers(id, client_id)
      on delete set null (driver_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clearinghouse_records'::regclass
      and conname = 'clearinghouse_records_document_client_fkey'
  ) then
    alter table public.clearinghouse_records
      add constraint clearinghouse_records_document_client_fkey
      foreign key (document_id, client_id)
      references public.documents(id, client_id)
      on delete set null (document_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_expiration_events'::regclass
      and conname = 'compliance_expiration_events_digest_client_fkey'
  ) then
    alter table public.compliance_expiration_events
      add constraint compliance_expiration_events_digest_client_fkey
      foreign key (digest_id, client_id)
      references public.compliance_expiration_digests(id, client_id)
      on delete set null (digest_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_expiration_events'::regclass
      and conname = 'compliance_expiration_events_alert_client_fkey'
  ) then
    alter table public.compliance_expiration_events
      add constraint compliance_expiration_events_alert_client_fkey
      foreign key (alert_id, client_id)
      references public.alerts(id, client_id)
      on delete set null (alert_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_expiration_events'::regclass
      and conname = 'compliance_expiration_events_request_client_fkey'
  ) then
    alter table public.compliance_expiration_events
      add constraint compliance_expiration_events_request_client_fkey
      foreign key (client_request_id, client_id)
      references public.client_requests(id, client_id)
      on delete set null (client_request_id) not valid;
  end if;
end
$tenant_constraints$;

alter table public.driver_documents
  validate constraint driver_documents_driver_client_fkey;
alter table public.driver_documents
  validate constraint driver_documents_document_client_fkey;
alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_vehicle_client_fkey;
alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_document_client_fkey;
alter table public.clearinghouse_records
  validate constraint clearinghouse_records_driver_client_fkey;
alter table public.clearinghouse_records
  validate constraint clearinghouse_records_document_client_fkey;
alter table public.compliance_expiration_events
  validate constraint compliance_expiration_events_digest_client_fkey;
alter table public.compliance_expiration_events
  validate constraint compliance_expiration_events_alert_client_fkey;
alter table public.compliance_expiration_events
  validate constraint compliance_expiration_events_request_client_fkey;

create unique index if not exists driver_documents_driver_type_unique
  on public.driver_documents(driver_id, doc_type);
create index if not exists idx_drivers_active_cdl_expiry
  on public.drivers(client_id, cdl_expiry)
  where status = 'active' and cdl_expiry is not null;
create index if not exists idx_drivers_active_medical_expiry
  on public.drivers(client_id, medical_cert_expiry)
  where status = 'active' and medical_cert_expiry is not null;
create index if not exists idx_driver_documents_client_expiry
  on public.driver_documents(client_id, expiry_date)
  where expiry_date is not null;
create index if not exists idx_vehicles_active_annual_inspection
  on public.vehicles(client_id, annual_inspection_date)
  where status = 'active' and annual_inspection_date is not null;
create index if not exists idx_vehicle_maintenance_client_completed
  on public.vehicle_maintenance(client_id, completed_date desc);
create index if not exists idx_clearinghouse_client_driver_query
  on public.clearinghouse_records(client_id, driver_id, query_date desc);
create unique index if not exists clearinghouse_driver_query_date_unique
  on public.clearinghouse_records(driver_id, query_date)
  where driver_id is not null;
create index if not exists idx_compliance_expiration_events_retry
  on public.compliance_expiration_events(status, claimed_at, created_at)
  where status in ('pending', 'processing', 'failed');
create index if not exists idx_compliance_expiration_events_client_due
  on public.compliance_expiration_events(client_id, due_date, created_at);
create index if not exists idx_compliance_expiration_events_digest
  on public.compliance_expiration_events(digest_id)
  where digest_id is not null;
create index if not exists idx_compliance_expiration_digests_retry
  on public.compliance_expiration_digests(status, claimed_at, digest_date)
  where status in ('pending', 'processing', 'failed');

do $updated_at_triggers$
declare
  target_table text;
  trigger_name text;
begin
  foreach target_table in array array[
    'drivers',
    'driver_documents',
    'vehicles',
    'vehicle_maintenance',
    'client_compliance_profiles',
    'compliance_expiration_events',
    'compliance_expiration_digests'
  ]
  loop
    trigger_name := 'trg_' || target_table || '_updated_at';
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', target_table)::regclass
        and tgname = trigger_name
        and not tgisinternal
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.update_updated_at()',
        trigger_name,
        target_table
      );
    end if;
  end loop;
end
$updated_at_triggers$;

create or replace function public.sync_vehicle_annual_inspection_date_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.maintenance_type = 'annual_inspection'
     and new.completed_date is not null then
    update public.vehicles
    set annual_inspection_date = new.completed_date
    where id = new.vehicle_id
      and client_id = new.client_id
      and (
        annual_inspection_date is null
        or annual_inspection_date < new.completed_date
      );
  end if;
  return new;
end
$function$;

revoke execute on function public.sync_vehicle_annual_inspection_date_v1()
  from public, anon, authenticated;
grant execute on function public.sync_vehicle_annual_inspection_date_v1()
  to service_role;

do $annual_inspection_trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.vehicle_maintenance'::regclass
      and tgname = 'trg_vehicle_maintenance_annual_inspection'
      and not tgisinternal
  ) then
    create trigger trg_vehicle_maintenance_annual_inspection
      after insert or update of maintenance_type, completed_date, vehicle_id, client_id
      on public.vehicle_maintenance
      for each row execute function public.sync_vehicle_annual_inspection_date_v1();
  end if;
end
$annual_inspection_trigger$;

alter table public.client_compliance_profiles enable row level security;
alter table public.compliance_expiration_events enable row level security;
alter table public.compliance_expiration_digests enable row level security;

-- Existing compliance tables expose only Total Safety rows to linked portal users.
-- GEIA staff retain the operator-wide read path. This restrictive policy composes
-- with the existing own-client/staff permissive read policies.
do $compliance_tier_policies$
declare
  target_table text;
begin
  foreach target_table in array array[
    'drivers',
    'driver_documents',
    'vehicles',
    'vehicle_maintenance',
    'clearinghouse_records'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = 'compliance_total_safety_select_guard'
    ) then
      execute format(
        'create policy compliance_total_safety_select_guard on public.%I as restrictive for select to authenticated using ((select public.is_geia_staff()) or exists (select 1 from public.clients c where c.id = client_id and c.id = (select public.get_user_client_id()) and c.tier = ''total_safety''::public.client_tier))',
        target_table
      );
    end if;
  end loop;
end
$compliance_tier_policies$;

do $profile_policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'client_compliance_profiles'
      and policyname = 'client_compliance_profiles_read'
  ) then
    create policy client_compliance_profiles_read
      on public.client_compliance_profiles for select to authenticated
      using (
        (select public.is_geia_staff())
        or exists (
          select 1 from public.clients c
          where c.id = client_id
            and c.id = (select public.get_user_client_id())
            and c.tier = 'total_safety'::public.client_tier
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'client_compliance_profiles'
      and policyname = 'client_compliance_profiles_staff_insert'
  ) then
    create policy client_compliance_profiles_staff_insert
      on public.client_compliance_profiles for insert to authenticated
      with check ((select public.is_geia_staff()));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'client_compliance_profiles'
      and policyname = 'client_compliance_profiles_staff_update'
  ) then
    create policy client_compliance_profiles_staff_update
      on public.client_compliance_profiles for update to authenticated
      using ((select public.is_geia_staff()))
      with check ((select public.is_geia_staff()));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'client_compliance_profiles'
      and policyname = 'client_compliance_profiles_staff_delete'
  ) then
    create policy client_compliance_profiles_staff_delete
      on public.client_compliance_profiles for delete to authenticated
      using ((select public.is_geia_staff()));
  end if;
end
$profile_policies$;

do $ledger_policies$
declare
  target_table text;
begin
  foreach target_table in array array[
    'compliance_expiration_events',
    'compliance_expiration_digests'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = 'compliance_ledger_staff_read'
    ) then
      execute format(
        'create policy compliance_ledger_staff_read on public.%I for select to authenticated using ((select public.is_geia_staff()))',
        target_table
      );
    end if;
  end loop;
end
$ledger_policies$;

-- Gate only compliance-specific queue/document rows. Unrelated requests and files keep
-- their existing access model.
do $shared_row_guards$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'client_requests'
      and policyname = 'client_requests_compliance_tier_guard'
  ) then
    create policy client_requests_compliance_tier_guard
      on public.client_requests as restrictive for select to authenticated
      using (
        (
          category not like 'compliance\_%' escape '\'
          and category <> 'dqf_roster'
        )
        or (select public.is_geia_staff())
        or exists (
          select 1 from public.clients c
          where c.id = client_id
            and c.id = (select public.get_user_client_id())
            and c.tier = 'total_safety'::public.client_tier
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'documents_compliance_tier_select_guard'
  ) then
    create policy documents_compliance_tier_select_guard
      on public.documents as restrictive for select to authenticated
      using (
        category not in (
          'dqf'::public.document_category,
          'maintenance'::public.document_category,
          'clearinghouse'::public.document_category
        )
        or (select public.is_geia_staff())
        or exists (
          select 1 from public.clients c
          where c.id = client_id
            and c.id = (select public.get_user_client_id())
            and c.tier = 'total_safety'::public.client_tier
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'documents_compliance_tier_insert_guard'
  ) then
    create policy documents_compliance_tier_insert_guard
      on public.documents as restrictive for insert to authenticated
      with check (
        category not in (
          'dqf'::public.document_category,
          'maintenance'::public.document_category,
          'clearinghouse'::public.document_category
        )
        or (select public.is_geia_staff())
        or exists (
          select 1 from public.clients c
          where c.id = client_id
            and c.id = (select public.get_user_client_id())
            and c.tier = 'total_safety'::public.client_tier
        )
      );
  end if;
end
$shared_row_guards$;

revoke all privileges on table public.client_compliance_profiles from anon;
revoke all privileges on table public.compliance_expiration_events from anon, authenticated;
revoke all privileges on table public.compliance_expiration_digests from anon, authenticated;
revoke all privileges on table public.client_compliance_profiles from authenticated;

grant select, insert, update, delete
  on table public.client_compliance_profiles to authenticated;
grant select
  on table public.compliance_expiration_events,
           public.compliance_expiration_digests
  to authenticated;
grant all privileges
  on table public.client_compliance_profiles,
           public.compliance_expiration_events,
           public.compliance_expiration_digests
  to service_role;

comment on table public.client_compliance_profiles is
  'Operational Total Safety compliance settings; never used for billing.';
comment on column public.clients.driver_count is
  'Client-stated service-plan driver count and sole per-driver billing input; never synchronized from public.drivers.';
comment on table public.compliance_expiration_events is
  'Idempotent per-item/per-threshold compliance alert work with retry state.';
comment on table public.compliance_expiration_digests is
  'One concurrency-safe operations notification digest per client and calendar day.';
