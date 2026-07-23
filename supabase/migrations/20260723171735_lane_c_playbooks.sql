create table if not exists public.client_playbooks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null check (version > 0),
  template_version text not null,
  trailing_window_days integer not null default 90
    check (trailing_window_days > 0),
  source_as_of date not null,
  owner_curriculum jsonb not null
    check (jsonb_typeof(owner_curriculum) = 'array'),
  family_programs jsonb not null
    check (jsonb_typeof(family_programs) = 'array'),
  installment_calendar jsonb not null
    check (jsonb_typeof(installment_calendar) = 'array'),
  ai_content jsonb not null
    check (jsonb_typeof(ai_content) = 'object'),
  source_snapshot jsonb not null
    check (jsonb_typeof(source_snapshot) = 'object'),
  generated_by uuid not null references public.users(id),
  generated_at timestamptz not null default now(),
  constraint client_playbooks_client_version_key unique (client_id, version)
);

create index if not exists idx_client_playbooks_client_latest
  on public.client_playbooks (client_id, version desc);

alter table public.client_playbooks enable row level security;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_playbooks'
      and policyname = 'client_playbooks_staff_select'
  ) then
    create policy client_playbooks_staff_select
      on public.client_playbooks
      for select
      to authenticated
      using (public.is_geia_staff());
  end if;
end
$policy$;

revoke all on table public.client_playbooks from anon;
revoke insert, update, delete on table public.client_playbooks from authenticated;
grant select on table public.client_playbooks to authenticated;
grant all on table public.client_playbooks to service_role;

comment on table public.client_playbooks is
  'Immutable, versioned Lane C owner curriculum, family programs, and monthly installment plans.';
comment on column public.client_playbooks.owner_curriculum is
  'Deterministic four-module owner curriculum from the locked U3 artifact.';
comment on column public.client_playbooks.family_programs is
  'Only Lane C families present at generation time, with live violations, points, inflow, curated program, and bounded AI narrative.';
comment on column public.client_playbooks.installment_calendar is
  'Deterministic 12-month bite-size delivery sequence from the locked U3 artifact.';
comment on column public.client_playbooks.ai_content is
  'Validated narrative glue returned by the model; never the playbook structure or live metrics.';
comment on column public.client_playbooks.source_snapshot is
  'Generation-time Lane C facts and mapping evidence used to audit the immutable version.';
