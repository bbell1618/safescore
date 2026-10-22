-- LexisNexis police report orders (QF-120, piece C of the gateway build).
-- One row per report ordered through the fixed-IP gateway. Service-role writes
-- only; GEIA staff can read. The report PDFs live in the private
-- police-reports bucket and are reached through short-lived signed links.
--
-- Guard rail: purpose is limited to insurance claims investigation, which is
-- what the LexisNexis Claims Services Order permits. Using a report as DataQs /
-- CPDP evidence stays blocked until LexisNexis confirms in writing that it is
-- allowed; widening the purpose list then needs a new migration on purpose.
create table if not exists public.police_report_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  crash_id uuid references public.crashes(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_via text not null check (requested_via in ('safescore', 'operations')),
  purpose text not null default 'insurance_claims_investigation'
    check (purpose in ('insurance_claims_investigation')),
  purpose_note text,
  state char(2) not null,
  date_of_loss date not null,
  agency_report_number text,
  involved_names jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'ordered', 'ready', 'failed', 'cancelled')),
  lexis_order_ref text,
  expected_cost_low numeric(8, 2),
  expected_cost_high numeric(8, 2),
  billed_cost numeric(8, 2),
  report_path text,
  error text,
  ordered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint police_report_requests_cost_range
    check (expected_cost_low is null or expected_cost_high is null or expected_cost_high >= expected_cost_low),
  constraint police_report_requests_ready_has_file
    check (status <> 'ready' or report_path is not null),
  constraint police_report_requests_names_is_array
    check (jsonb_typeof(involved_names) = 'array')
);

comment on table public.police_report_requests is
  'Police reports ordered from LexisNexis through the fixed-IP gateway. Service-role writes only; GEIA staff read. Purpose limited to insurance claims investigation (see migration header).';
comment on column public.police_report_requests.report_path is
  'Object path inside the private police-reports bucket. Download only through a short-lived signed link.';
comment on column public.police_report_requests.billed_cost is
  'Cost as billed (LexisNexis fee plus the police department fee). Known only from the invoice, so it is filled in after the order.';

-- One live order per crash: stops a double click from buying the same report twice.
create unique index if not exists police_report_requests_one_live_per_crash
  on public.police_report_requests (crash_id)
  where crash_id is not null and status in ('queued', 'ordered', 'ready');
create unique index if not exists police_report_requests_lexis_order_ref_key
  on public.police_report_requests (lexis_order_ref)
  where lexis_order_ref is not null;
create index if not exists police_report_requests_client_idx on public.police_report_requests (client_id);
create index if not exists police_report_requests_crash_idx on public.police_report_requests (crash_id);
create index if not exists police_report_requests_requested_by_idx on public.police_report_requests (requested_by);
create index if not exists police_report_requests_status_created_idx on public.police_report_requests (status, created_at desc);

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'police_report_requests_updated_at'
      and tgrelid = 'public.police_report_requests'::regclass
  ) then
    create trigger police_report_requests_updated_at
      before update on public.police_report_requests
      for each row execute function public.update_updated_at();
  end if;
end $$;

alter table public.police_report_requests enable row level security;
revoke all on public.police_report_requests from anon, authenticated;
grant select on public.police_report_requests to authenticated;
grant all on public.police_report_requests to service_role;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'police_report_requests'
      and policyname = 'police_report_requests_staff_read'
  ) then
    create policy police_report_requests_staff_read on public.police_report_requests
      for select to authenticated using ((select public.is_geia_staff()));
  end if;
end $$;

-- Private bucket for the report PDFs. No public access; staff can read through
-- a signed link; only the service role writes (it bypasses row level security).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('police-reports', 'police-reports', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Staff can read police reports'
  ) then
    create policy "Staff can read police reports" on storage.objects
      for select to authenticated
      using (bucket_id = 'police-reports' and (select public.is_geia_staff()));
  end if;
end $$;
