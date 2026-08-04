-- Run A: durable, retryable exactly-one-at-a-time initialization after a
-- client lifecycle transition reaches active. Route handlers remain
-- responsible for authenticating staff/portal/Stripe callers.

create table if not exists public.client_activation_initializations (
  client_id uuid primary key references public.clients(id) on delete cascade,
  activation_tier public.client_tier not null,
  activation_source text not null,
  status text not null default 'pending',
  claim_token uuid not null default gen_random_uuid(),
  attempt_count integer not null default 0,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_activation_initializations
  add column if not exists activation_tier public.client_tier,
  add column if not exists activation_source text,
  add column if not exists status text default 'pending',
  add column if not exists claim_token uuid default gen_random_uuid(),
  add column if not exists attempt_count integer default 0,
  add column if not exists claimed_at timestamptz default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists error text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.client_activation_initializations i
set activation_tier = c.tier
from public.clients c
where i.client_id = c.id
  and i.activation_tier is null
  and c.tier is not null;

update public.client_activation_initializations
set activation_source = coalesce(activation_source, 'lifecycle_transition'),
    status = coalesce(status, 'pending'),
    claim_token = coalesce(claim_token, gen_random_uuid()),
    attempt_count = coalesce(attempt_count, 0),
    claimed_at = coalesce(claimed_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());

alter table public.client_activation_initializations
  alter column activation_tier set not null,
  alter column activation_source set not null,
  alter column status set default 'pending',
  alter column status set not null,
  alter column claim_token set default gen_random_uuid(),
  alter column claim_token set not null,
  alter column attempt_count set default 0,
  alter column attempt_count set not null,
  alter column claimed_at set default now(),
  alter column claimed_at set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.client_activation_initializations'::regclass
      and conname = 'client_activation_initializations_status_check'
  ) then
    alter table public.client_activation_initializations
      add constraint client_activation_initializations_status_check
      check (status in ('pending', 'running', 'succeeded', 'failed'));
  end if;
end;
$migration$;

create index if not exists idx_client_activation_initializations_status
  on public.client_activation_initializations(status, claimed_at);

alter table public.client_activation_initializations enable row level security;

create or replace function public.enqueue_client_activation_initialization_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status::text is distinct from new.status::text
     and new.status::text = 'active' then
    if new.tier is null then
      raise exception 'CLIENT_TIER_REQUIRED: active clients require an assigned tier';
    end if;

    insert into public.client_activation_initializations (
      client_id,
      activation_tier,
      activation_source,
      status,
      attempt_count,
      metadata
    ) values (
      new.id,
      new.tier,
      'lifecycle_transition',
      'pending',
      0,
      jsonb_build_object(
        'from_status', old.status::text,
        'to_status', new.status::text,
        'enqueued_at', now()
      )
    )
    on conflict (client_id) do nothing;
  end if;
  return new;
end;
$function$;

do $migration$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.clients'::regclass
      and tgname = 'clients_enqueue_activation_initialization_v1'
      and not tgisinternal
  ) then
    execute $trigger$
      create trigger clients_enqueue_activation_initialization_v1
      after update of status on public.clients
      for each row
      execute function public.enqueue_client_activation_initialization_v1()
    $trigger$;
  end if;
end;
$migration$;

create or replace function public.claim_client_activation_initialization_v1(
  p_client_id uuid,
  p_tier public.client_tier,
  p_source text,
  p_create_if_missing boolean default false
)
returns table (
  claimed boolean,
  result_status text,
  result_claim_token uuid,
  result_attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_claim_token uuid := gen_random_uuid();
  v_status text;
  v_claimed_at timestamptz;
  v_existing_token uuid;
  v_attempt_count integer;
begin
  if nullif(btrim(p_source), '') is null then
    raise exception 'ACTIVATION_SOURCE_REQUIRED: activation source is required';
  end if;

  select
    i.status,
    i.claimed_at,
    i.claim_token,
    i.attempt_count
  into
    v_status,
    v_claimed_at,
    v_existing_token,
    v_attempt_count
  from public.client_activation_initializations i
  where i.client_id = p_client_id
  for update;

  if not found then
    if not p_create_if_missing then
      return query select false, 'not_enqueued'::text, null::uuid, 0;
      return;
    end if;

    insert into public.client_activation_initializations (
      client_id,
      activation_tier,
      activation_source,
      status,
      claim_token,
      attempt_count,
      claimed_at,
      metadata
    ) values (
      p_client_id,
      p_tier,
      p_source,
      'running',
      v_claim_token,
      1,
      now(),
      jsonb_build_object('claim_fallback', true)
    )
    on conflict (client_id) do nothing;

    if found then
      return query select true, 'running'::text, v_claim_token, 1;
      return;
    end if;

    select
      i.status,
      i.claimed_at,
      i.claim_token,
      i.attempt_count
    into
      v_status,
      v_claimed_at,
      v_existing_token,
      v_attempt_count
    from public.client_activation_initializations i
    where i.client_id = p_client_id
    for update;
  end if;

  if v_status = 'succeeded' then
    return query select false, v_status, v_existing_token, v_attempt_count;
    return;
  end if;

  if v_status = 'running'
     and v_claimed_at > now() - interval '15 minutes' then
    return query select false, v_status, v_existing_token, v_attempt_count;
    return;
  end if;

  update public.client_activation_initializations
  set activation_tier = p_tier,
      activation_source = p_source,
      status = 'running',
      claim_token = v_claim_token,
      attempt_count = v_attempt_count + 1,
      claimed_at = now(),
      completed_at = null,
      error = null,
      updated_at = now()
  where client_id = p_client_id;

  return query select true, 'running'::text, v_claim_token, v_attempt_count + 1;
end;
$function$;

revoke all on table public.client_activation_initializations
  from public, anon, authenticated;
revoke all on function public.enqueue_client_activation_initialization_v1()
  from public, anon, authenticated;
revoke all on function public.claim_client_activation_initialization_v1(
  uuid, public.client_tier, text, boolean
) from public, anon, authenticated;
grant select, insert, update, delete on table public.client_activation_initializations
  to service_role;
grant execute on function public.claim_client_activation_initialization_v1(
  uuid, public.client_tier, text, boolean
) to service_role;

comment on table public.client_activation_initializations is
  'Retry and idempotency ledger for first analysis and activation notifications.';
comment on function public.claim_client_activation_initialization_v1(
  uuid, public.client_tier, text, boolean
) is
  'Claims enqueued, failed, or stale activation work; optional creation is reserved for the just-transitioned caller.';

-- -------------------------------------------------------------------------
-- REQUEST TITLE CONTEXT + TARGETED BACKFILL (appended by the Run A parent)
-- -------------------------------------------------------------------------

with normalized as (
  select
    cr.id,
    cr.evidence_class,
    regexp_replace(btrim(v.violation_code), '\s+', ' ', 'g') as violation_code,
    regexp_replace(
      btrim(v.violation_description),
      '\s+',
      ' ',
      'g'
    ) as violation_description,
    i.inspection_date
  from public.client_requests cr
  join public.violations v
    on v.id = cr.violation_id
  join public.inspections i
    on i.id = v.inspection_id
  where cr.status = 'open'
    and cr.request_type = 'evidence'
    and cr.evidence_class in (
      'wrong-attribution',
      'duplicate',
      'citation-dismissed',
      'report-factual-error'
    )
    and nullif(btrim(v.violation_code), '') is not null
    and nullif(btrim(v.violation_description), '') is not null
    and i.inspection_date is not null
),
clipped as (
  select
    *,
    case
      when char_length(violation_description) <= 72
        then violation_description
      else rtrim(left(violation_description, 71))
    end as clipped_description
  from normalized
),
contextual as (
  select
    *,
    case
      when char_length(violation_description) <= 72
        then violation_description
      else
        (
          case
            when strpos(reverse(clipped_description), ' ') > 0
             and (
               char_length(clipped_description)
               - strpos(reverse(clipped_description), ' ')
             ) >= floor(72 * 0.6)::integer
              then left(
                clipped_description,
                char_length(clipped_description)
                - strpos(reverse(clipped_description), ' ')
              )
            else clipped_description
          end
        ) || chr(8230)
    end as short_description
  from clipped
),
desired as (
  select
    id,
    (
      case evidence_class
        when 'citation-dismissed'
          then 'Certified court disposition'
        when 'wrong-attribution'
          then 'Records showing this violation belongs to someone else'
        when 'duplicate'
          then 'Records needed to confirm a duplicate'
        when 'report-factual-error'
          then 'Records needed to prove a report error'
      end
      || ' ' || chr(8212) || ' '
      || violation_code
      || ' (' || short_description
      || ', ' || to_char(inspection_date, 'Mon FMDD, YYYY')
      || ')'
    ) as title
  from contextual
)
update public.client_requests cr
set
  title = desired.title,
  updated_at = now()
from desired
where cr.id = desired.id
  and cr.title is distinct from desired.title;
