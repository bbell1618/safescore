create table if not exists public.email_dry_run_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  to_address text not null,
  template text not null,
  subject text,
  body_html text,
  body_text text,
  action_links jsonb default '[]'::jsonb,
  client_id uuid null
);
alter table public.email_dry_run_outbox enable row level security;
revoke all on public.email_dry_run_outbox from anon, authenticated;
grant select, insert, delete on public.email_dry_run_outbox to authenticated;
grant all on public.email_dry_run_outbox to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_dry_run_outbox' and policyname='outbox_staff_select') then
    create policy outbox_staff_select on public.email_dry_run_outbox for select to authenticated using ((select public.is_geia_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_dry_run_outbox' and policyname='outbox_staff_insert') then
    create policy outbox_staff_insert on public.email_dry_run_outbox for insert to authenticated with check ((select public.is_geia_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_dry_run_outbox' and policyname='outbox_staff_delete') then
    create policy outbox_staff_delete on public.email_dry_run_outbox for delete to authenticated using ((select public.is_geia_staff()));
  end if;
end $$;
create index if not exists email_dry_run_outbox_created_at_idx on public.email_dry_run_outbox (created_at desc);
create index if not exists email_dry_run_outbox_client_id_idx on public.email_dry_run_outbox (client_id);
