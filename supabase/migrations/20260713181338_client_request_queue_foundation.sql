create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  dedupe_key text not null unique,
  category text not null,
  title text not null,
  description text,
  source text not null default 'standing' check (source in ('standing', 'case')),
  responsibility text not null default 'client' check (responsibility in ('client', 'geia')),
  case_type text check (case_type in ('dataq', 'cpdp') or case_type is null),
  case_id uuid,
  requested_items jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  due_at timestamptz,
  reminder_count integer not null default 0 check (reminder_count >= 0),
  reminder_limit integer not null default 3 check (reminder_limit > 0),
  reminder_interval_days integer not null default 7 check (reminder_interval_days > 0),
  last_reminded_at timestamptz,
  next_reminder_at timestamptz,
  escalated_at timestamptz,
  closed_at timestamptz,
  upload_token uuid not null default gen_random_uuid() unique,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_requests_client_status
  on public.client_requests(client_id, status, created_at desc);
create index if not exists idx_client_requests_reminders
  on public.client_requests(next_reminder_at)
  where status = 'open' and responsibility = 'client';

alter table public.client_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requests'
      and policyname = 'client_requests_staff'
  ) then
    create policy client_requests_staff on public.client_requests
      for all to authenticated
      using (is_geia_staff()) with check (is_geia_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requests'
      and policyname = 'client_requests_client_select'
  ) then
    create policy client_requests_client_select on public.client_requests
      for select to authenticated
      using (client_id = get_user_client_id());
  end if;
end
$$;
