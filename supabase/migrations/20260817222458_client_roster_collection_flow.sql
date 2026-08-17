-- Run G: stage client-submitted driver rosters until a staff member approves them.
-- Keep the request and driver changes additive and safe to re-run after a partial apply.

alter table public.drivers
  add column if not exists source text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists request_id uuid,
  add column if not exists notes text;

alter table public.drivers
  alter column source set default 'operator';

update public.drivers
set source = 'operator'
where source is null;

alter table public.drivers
  alter column source set not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.drivers'::regclass
      and conname = 'drivers_source_check'
  ) then
    alter table public.drivers
      add constraint drivers_source_check
      check (source in ('operator', 'client_portal')) not valid;
  end if;
end
$migration$;

alter table public.drivers
  validate constraint drivers_source_check;

update public.drivers
set approved_at = created_at
where source = 'operator'
  and approved_at is null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.drivers'::regclass
      and conname = 'drivers_request_client_fkey'
  ) then
    alter table public.drivers
      add constraint drivers_request_client_fkey
      foreign key (request_id, client_id)
      references public.client_requests (id, client_id)
      on delete set null (request_id)
      not valid;
  end if;
end
$migration$;

alter table public.drivers
  validate constraint drivers_request_client_fkey;

alter table public.client_requests
  drop constraint if exists client_requests_request_type_check;

alter table public.client_requests
  add constraint client_requests_request_type_check
  check (
    request_type is null
    or request_type in ('evidence', 'question', 'roster_collection')
  ) not valid;

alter table public.client_requests
  validate constraint client_requests_request_type_check;

create index if not exists idx_drivers_pending_review
  on public.drivers (client_id, created_at, id)
  where source = 'client_portal' and approved_at is null;

create index if not exists idx_drivers_request_client
  on public.drivers (request_id, client_id)
  where request_id is not null;
