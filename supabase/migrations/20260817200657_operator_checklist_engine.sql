-- Run F: derived operator checklist state.
-- Checklist work remains derived from source tables; these tables store only
-- explicit staff acknowledgements/snoozes and manual items.

alter table public.alerts
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid;

do $alerts_ack_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.alerts'::regclass
      and conname = 'alerts_acknowledged_by_fkey'
  ) then
    alter table public.alerts
      add constraint alerts_acknowledged_by_fkey
      foreign key (acknowledged_by)
      references public.users(id)
      on delete set null;
  end if;
end
$alerts_ack_fk$;

create table if not exists public.operator_item_acks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  rule_key text not null,
  context_key text not null,
  action text not null check (action in ('done', 'snooze')),
  snoozed_until timestamptz,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.operator_manual_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  details text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

alter table public.cpdp_cases
  add column if not exists determination_outcome text,
  add column if not exists determination_recorded_at timestamptz;

alter table public.dataq_cases
  add column if not exists determination_outcome text,
  add column if not exists determination_recorded_at timestamptz;

create index if not exists idx_alerts_unacknowledged
  on public.alerts(client_id, created_at desc)
  where acknowledged_at is null;

create index if not exists idx_alerts_acknowledged_by
  on public.alerts(acknowledged_by)
  where acknowledged_by is not null;

create index if not exists idx_operator_item_acks_context
  on public.operator_item_acks(client_id, rule_key, context_key);

create unique index if not exists idx_operator_item_acks_done_once
  on public.operator_item_acks(client_id, rule_key, context_key)
  where action = 'done';

create index if not exists idx_operator_item_acks_created_by
  on public.operator_item_acks(created_by)
  where created_by is not null;

create index if not exists idx_operator_manual_items_open
  on public.operator_manual_items(client_id, status, due_date, created_at)
  where deleted_at is null;

create index if not exists idx_operator_manual_items_created_by
  on public.operator_manual_items(created_by)
  where created_by is not null;

create index if not exists idx_cpdp_cases_open_determination
  on public.cpdp_cases(client_id, filed_date)
  where status = 'filed' and determination_outcome is null;

create index if not exists idx_dataq_cases_open_determination
  on public.dataq_cases(client_id, filed_date)
  where status = 'filed' and determination_outcome is null;

alter table public.operator_item_acks enable row level security;
alter table public.operator_manual_items enable row level security;

-- The legacy alert policy permits linked clients to mark an alert read or
-- dismissed. Keep that behavior while preventing direct Data API writes to the
-- staff-only acknowledgement columns; the staff endpoint uses service_role.
revoke select, update on table public.alerts from public, anon;
revoke select on table public.alerts from authenticated;
grant select (
  id,
  client_id,
  type,
  severity,
  title,
  message,
  entity_type,
  entity_id,
  read_at,
  dismissed_at,
  created_at
) on table public.alerts to authenticated;
revoke update on table public.alerts from authenticated;
grant update (read_at, dismissed_at) on table public.alerts to authenticated;

do $operator_checklist_policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operator_item_acks'
      and policyname = 'operator_item_acks_staff'
  ) then
    create policy operator_item_acks_staff
      on public.operator_item_acks
      for all
      to authenticated
      using ((select public.is_geia_staff()))
      with check ((select public.is_geia_staff()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operator_manual_items'
      and policyname = 'operator_manual_items_staff'
  ) then
    create policy operator_manual_items_staff
      on public.operator_manual_items
      for all
      to authenticated
      using ((select public.is_geia_staff()))
      with check ((select public.is_geia_staff()));
  end if;
end
$operator_checklist_policies$;

revoke all on table public.operator_item_acks from public, anon, authenticated;
revoke all on table public.operator_manual_items from public, anon, authenticated;
grant select, insert, update, delete on table public.operator_item_acks to authenticated;
grant select, insert, update, delete on table public.operator_manual_items to authenticated;
grant all on table public.operator_item_acks to service_role;
grant all on table public.operator_manual_items to service_role;

comment on table public.operator_item_acks is
  'Staff decisions that suppress a derived operator checklist rule/context pair.';
comment on table public.operator_manual_items is
  'Ad-hoc staff work only; system checklist items remain derived from live source tables.';
comment on column public.alerts.acknowledged_at is
  'Staff acknowledgement timestamp; distinct from the client-facing read_at field.';
comment on column public.cpdp_cases.determination_outcome is
  'Recorded external determination used to close the operator follow-up rule.';
comment on column public.dataq_cases.determination_outcome is
  'Recorded external determination used to close the operator follow-up rule.';
