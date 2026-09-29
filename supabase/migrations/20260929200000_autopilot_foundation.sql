-- SafeScore Autopilot foundation (2026-09-29).
-- One rule for the whole product: nothing leaves GEIA without an approved card.
-- outbound_queue is the approval inbox; safety_plans holds the plain-English
-- plan shown on each carrier's no-password plan link.

create table if not exists public.outbound_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid null references public.clients(id) on delete cascade,
  kind text not null default 'email'
    check (kind in ('email','report_send','playbook_publish','filing_packet','needs_info')),
  template text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','sent','rejected','failed','superseded')),
  title text not null,
  why text,
  to_address text,
  cc text,
  from_identity text not null default 'sunny',
  subject text,
  body_html text,
  body_text text,
  editable boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_by text not null default 'autopilot',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid null references public.users(id) on delete set null,
  decision_note text,
  edited boolean not null default false,
  sent_at timestamptz,
  send_result jsonb,
  error text
);
create unique index if not exists outbound_queue_pending_dedupe_uidx
  on public.outbound_queue (dedupe_key) where status = 'pending' and dedupe_key is not null;
create index if not exists outbound_queue_status_created_idx on public.outbound_queue (status, created_at desc);
create index if not exists outbound_queue_client_idx on public.outbound_queue (client_id);
create index if not exists outbound_queue_decided_by_idx on public.outbound_queue (decided_by);

alter table public.outbound_queue enable row level security;
revoke all on public.outbound_queue from anon, authenticated;
grant select, update on public.outbound_queue to authenticated;
grant all on public.outbound_queue to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='outbound_queue' and policyname='outbound_queue_staff_select') then
    create policy outbound_queue_staff_select on public.outbound_queue for select to authenticated using ((select public.is_geia_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='outbound_queue' and policyname='outbound_queue_staff_update') then
    create policy outbound_queue_staff_update on public.outbound_queue for update to authenticated
      using ((select public.is_geia_staff())) with check ((select public.is_geia_staff()));
  end if;
end $$;

create table if not exists public.safety_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  content jsonb not null,
  facts jsonb not null default '{}'::jsonb,
  model text,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (client_id, version)
);
create index if not exists safety_plans_client_status_idx on public.safety_plans (client_id, status, version desc);
alter table public.safety_plans enable row level security;
revoke all on public.safety_plans from anon, authenticated;
grant select on public.safety_plans to authenticated;
grant all on public.safety_plans to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='safety_plans' and policyname='safety_plans_staff_select') then
    create policy safety_plans_staff_select on public.safety_plans for select to authenticated using ((select public.is_geia_staff()));
  end if;
end $$;

alter table public.clients add column if not exists plan_token uuid not null default gen_random_uuid();
alter table public.clients add column if not exists intake_source text;
alter table public.clients add column if not exists contact_source text;
alter table public.clients add column if not exists goldendesk_client_id uuid;
alter table public.clients add column if not exists plan_first_viewed_at timestamptz;
alter table public.clients add column if not exists plan_last_viewed_at timestamptz;
create unique index if not exists clients_plan_token_uidx on public.clients (plan_token);
