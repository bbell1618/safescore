-- U8 hardening: terminal state, linked request, and audit proof commit together.

create or replace function public.record_mcs150_submission_v1(
  p_client_id uuid,
  p_update_id uuid,
  p_submitted_date date,
  p_proposed_changes jsonb,
  p_trigger_key text,
  p_trigger_reasons jsonb,
  p_attested_snapshot jsonb,
  p_honesty_prediction jsonb,
  p_biennial_due_date date,
  p_notes text,
  p_request_description text,
  p_user_id uuid
)
returns table (
  update_id uuid,
  status text,
  submitted_date date,
  client_request_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_request_id uuid;
  v_profile_source text;
begin
  select source
    into v_profile_source
  from public.client_attested_profiles
  where client_id = p_client_id;

  if v_profile_source is distinct from 'operator_recorded' then
    raise exception 'Carrier-attested values must be recorded before submission';
  end if;

  select mu.client_request_id
    into v_request_id
  from public.mcs150_updates as mu
  where mu.id = p_update_id
    and mu.client_id = p_client_id
    and mu.status in ('draft', 'pending_review')
    and mu.census_snapshot is not null
  for update;

  if not found then
    raise exception 'Editable MCS-150 draft with a census baseline not found';
  end if;
  if v_request_id is null then
    raise exception 'MCS-150 draft is not linked to a client request';
  end if;

  update public.client_requests as cr
  set description = p_request_description,
      updated_at = now()
  where cr.id = v_request_id
    and cr.client_id = p_client_id
    and cr.status = 'open';

  if not found then
    raise exception 'Linked open MCS-150 client request not found';
  end if;

  update public.mcs150_updates as mu
  set status = 'submitted',
      submitted_date = p_submitted_date,
      proposed_changes = p_proposed_changes,
      trigger_key = p_trigger_key,
      trigger_reasons = p_trigger_reasons,
      attested_snapshot = p_attested_snapshot,
      honesty_prediction = p_honesty_prediction,
      biennial_due_date = p_biennial_due_date,
      last_checked_at = now(),
      updated_at = now(),
      notes = p_notes
  where mu.id = p_update_id
    and mu.client_id = p_client_id
    and mu.status in ('draft', 'pending_review');

  if not found then
    raise exception 'MCS-150 draft changed before submission could be recorded';
  end if;

  insert into public.activity_log (
    client_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values (
    p_client_id,
    p_user_id,
    'mcs150_submission_recorded',
    'mcs150_updates',
    p_update_id,
    'Carrier attestation and Login.gov submission were recorded; SafeScore is awaiting a newer matching public census.',
    jsonb_build_object(
      'update_id', p_update_id,
      'client_request_id', v_request_id,
      'submitted_date', p_submitted_date,
      'filed_by', 'carrier',
      'safescore_filed', false,
      'postcondition', 'committed_atomically'
    )
  );

  return query
  select
    p_update_id,
    mu.status,
    mu.submitted_date,
    mu.client_request_id
  from public.mcs150_updates as mu
  where mu.id = p_update_id;
end;
$function$;

create or replace function public.confirm_mcs150_update_v1(
  p_client_id uuid,
  p_update_id uuid,
  p_confirmed_date date,
  p_confirmed_census_snapshot jsonb,
  p_checked_at timestamptz
)
returns table (
  update_id uuid,
  status text,
  client_request_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_request_id uuid;
begin
  select mu.client_request_id
    into v_request_id
  from public.mcs150_updates as mu
  where mu.id = p_update_id
    and mu.client_id = p_client_id
    and mu.status = 'submitted'
  for update;

  if not found then
    raise exception 'Submitted MCS-150 update not found';
  end if;
  if v_request_id is null then
    raise exception 'Submitted MCS-150 update has no linked client request';
  end if;

  update public.client_requests as cr
  set status = 'fulfilled',
      closed_at = p_checked_at,
      next_reminder_at = null,
      updated_at = p_checked_at
  where cr.id = v_request_id
    and cr.client_id = p_client_id
    and cr.status = 'open';

  if not found then
    raise exception 'Linked open MCS-150 client request not found';
  end if;

  update public.mcs150_updates as mu
  set status = 'confirmed',
      confirmed_date = p_confirmed_date,
      confirmed_census_snapshot = p_confirmed_census_snapshot,
      last_checked_at = p_checked_at,
      updated_at = p_checked_at
  where mu.id = p_update_id
    and mu.client_id = p_client_id
    and mu.status = 'submitted';

  if not found then
    raise exception 'MCS-150 update changed before confirmation could be recorded';
  end if;

  insert into public.activity_log (
    client_id,
    action_type,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values (
    p_client_id,
    'mcs150_truth_up_closed',
    'mcs150_updates',
    p_update_id,
    'Public FMCSA census now matches the proposed MCS-150 figures; the update and linked client request were closed.',
    jsonb_build_object(
      'update_id', p_update_id,
      'client_request_id', v_request_id,
      'confirmed_census_snapshot', p_confirmed_census_snapshot,
      'postcondition', 'committed_atomically'
    )
  );

  return query
  select
    p_update_id,
    mu.status,
    mu.client_request_id
  from public.mcs150_updates as mu
  where mu.id = p_update_id;
end;
$function$;

revoke all on function public.record_mcs150_submission_v1(
  uuid, uuid, date, jsonb, text, jsonb, jsonb, jsonb, date, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_mcs150_submission_v1(
  uuid, uuid, date, jsonb, text, jsonb, jsonb, jsonb, date, text, text, uuid
) to service_role;

revoke all on function public.confirm_mcs150_update_v1(
  uuid, uuid, date, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.confirm_mcs150_update_v1(
  uuid, uuid, date, jsonb, timestamptz
) to service_role;

do $policies$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_log'
      and policyname = 'activity_log_mcs150_tier_guard'
  ) then
    create policy activity_log_mcs150_tier_guard
      on public.activity_log
      as restrictive
      for select
      to authenticated
      using (
        action_type not like 'mcs150_%'
        or (select public.is_geia_staff())
        or exists (
          select 1
          from public.clients
          where clients.id = activity_log.client_id
            and clients.id = (select public.get_user_client_id())
            and clients.tier = 'total_safety'
        )
      );
  end if;
end
$policies$;
