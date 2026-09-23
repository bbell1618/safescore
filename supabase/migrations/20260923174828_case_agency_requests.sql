-- Staff predicates mirror 20260722224045_advisor_hardening.sql (dq_staff_*).
-- Agency asks are internal: unlike dq_read, no client ownership SELECT branch.
create table if not exists public.case_agency_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  case_kind text not null check (case_kind in ('dataq', 'cpdp')),
  case_id uuid not null,
  requested_on date not null,
  response_due date not null,
  requesting_agency text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  request_text text not null,
  status text not null default 'open' check (status in ('open', 'responded', 'lapsed')),
  responded_on date,
  response_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (response_due >= requested_on),
  check (status <> 'responded' or responded_on is not null)
);
create index if not exists case_agency_requests_case_idx on public.case_agency_requests (case_kind, case_id);
create index if not exists case_agency_requests_client_status_idx on public.case_agency_requests (client_id, status);
alter table public.case_agency_requests enable row level security;
revoke all on public.case_agency_requests from public, anon, authenticated;
grant select, insert, update, delete on public.case_agency_requests to authenticated;
grant all on public.case_agency_requests to service_role;

do $migration$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='case_agency_requests' and policyname='car_staff_read') then
    create policy car_staff_read on public.case_agency_requests for select to authenticated using ((select public.is_geia_staff()));
    create policy car_staff_insert on public.case_agency_requests for insert to authenticated with check ((select public.is_geia_staff()));
    create policy car_staff_update on public.case_agency_requests for update to authenticated using ((select public.is_geia_staff())) with check ((select public.is_geia_staff()));
    create policy car_staff_delete on public.case_agency_requests for delete to authenticated using ((select public.is_geia_staff()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.case_agency_requests'::regclass and tgname='case_agency_requests_updated_at') then
    create trigger case_agency_requests_updated_at before update on public.case_agency_requests for each row execute function public.update_updated_at();
  end if;
end
$migration$;
