-- Atomic state transitions used by the onboarding and billing route handlers.
-- These are SECURITY INVOKER functions and are callable only by service_role;
-- route handlers remain responsible for authenticating the human caller.

create or replace function public.change_client_onboarding_tier_v1(
  p_client_id uuid,
  p_user_id uuid,
  p_selected_tier public.client_tier
)
returns table (
  result_tier text,
  original_assigned_tier text,
  previous_tier text,
  changed boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_status text;
  v_previous_tier text;
  v_original_assigned_tier text;
  v_agreement_accepted boolean;
begin
  select c.status::text, c.tier::text, c.service_agreement_accepted
    into v_status, v_previous_tier, v_agreement_accepted
  from public.clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_NOT_FOUND: onboarding client was not found';
  end if;
  if v_status not in ('onboarding', 'prospect') then
    raise exception 'ONBOARDING_LOCKED: tier changes are unavailable after activation submission';
  end if;
  if v_previous_tier is null then
    raise exception 'CLIENT_TIER_REQUIRED: GEIA must assign a tier before onboarding';
  end if;
  if v_agreement_accepted is not true then
    raise exception 'SERVICE_AGREEMENT_REQUIRED: complete the service agreement before changing Step 4';
  end if;

  select a.metadata ->> 'assigned_tier'
    into v_original_assigned_tier
  from public.activity_log a
  where a.client_id = p_client_id
    and a.action_type = 'tier_changed_by_client'
    and a.metadata ->> 'assigned_tier' in (
      'assessment', 'monitor', 'remediate', 'total_safety'
    )
  order by a.created_at asc, a.id asc
  limit 1;

  v_original_assigned_tier := coalesce(
    v_original_assigned_tier,
    v_previous_tier
  );

  if v_previous_tier = p_selected_tier::text then
    return query select
      v_previous_tier,
      v_original_assigned_tier,
      v_previous_tier,
      false;
    return;
  end if;

  update public.clients
  set tier = p_selected_tier,
      updated_at = now()
  where id = p_client_id;

  insert into public.activity_log (
    client_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    p_client_id,
    p_user_id,
    'tier_changed_by_client',
    'clients',
    p_client_id,
    format(
      'Client changed onboarding service tier from %s to %s (original GEIA assignment: %s)',
      v_previous_tier,
      p_selected_tier::text,
      v_original_assigned_tier
    ),
    jsonb_build_object(
      'assigned_tier', v_original_assigned_tier,
      'previous_tier', v_previous_tier,
      'selected_tier', p_selected_tier::text,
      'requires_staff_follow_up', true,
      'source', 'onboarding_step_4'
    )
  );

  return query select
    p_selected_tier::text,
    v_original_assigned_tier,
    v_previous_tier,
    true;
end;
$function$;

create or replace function public.submit_assessment_activation_v1(
  p_client_id uuid,
  p_user_id uuid
)
returns table (
  result_status text,
  result_tier text,
  already_submitted boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_status text;
  v_tier text;
  v_agreement_accepted boolean;
  v_primary_contact text;
  v_phone text;
  v_vehicle_types text[];
  v_operating_states text[];
  v_operating_radius text;
  v_driver_count integer;
  v_citation_answer boolean;
  v_missing text[] := array[]::text[];
begin
  select
    c.status::text,
    c.tier::text,
    c.service_agreement_accepted,
    c.primary_contact,
    c.phone,
    c.vehicle_types,
    c.operating_states,
    c.operating_radius,
    c.driver_count,
    c.citation_dismissed_last_24_months
    into
      v_status,
      v_tier,
      v_agreement_accepted,
      v_primary_contact,
      v_phone,
      v_vehicle_types,
      v_operating_states,
      v_operating_radius,
      v_driver_count,
      v_citation_answer
  from public.clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_NOT_FOUND: onboarding client was not found';
  end if;
  if v_tier is null then
    raise exception 'CLIENT_TIER_REQUIRED: GEIA must assign a tier before activation';
  end if;
  if v_tier <> 'assessment' then
    raise exception 'SUBSCRIPTION_CHECKOUT_REQUIRED: recurring tiers activate through Stripe checkout';
  end if;
  if nullif(btrim(coalesce(v_primary_contact, '')), '') is null
     or lower(btrim(v_primary_contact)) = any(array[
       'pending onboarding', 'pending invite', 'invite pending',
       'onboarding contact pending', 'to be provided', 'tbd'
     ]) then
    v_missing := array_append(v_missing, 'primary contact name');
  end if;
  if nullif(btrim(coalesce(v_phone, '')), '') is null then
    v_missing := array_append(v_missing, 'contact phone');
  end if;
  if coalesce(cardinality(v_vehicle_types), 0) = 0 then
    v_missing := array_append(v_missing, 'vehicle types');
  end if;
  if coalesce(cardinality(v_operating_states), 0) = 0 then
    v_missing := array_append(v_missing, 'operating states');
  end if;
  if nullif(btrim(coalesce(v_operating_radius, '')), '') is null then
    v_missing := array_append(v_missing, 'operating radius');
  end if;
  if v_driver_count is null or v_driver_count < 1 then
    v_missing := array_append(v_missing, 'billing driver count');
  end if;
  if v_citation_answer is null then
    v_missing := array_append(v_missing, 'roadside-ticket answer');
  end if;
  if v_agreement_accepted is not true then
    v_missing := array_append(v_missing, 'service agreement');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'ONBOARDING_PROFILE_INCOMPLETE: still needed: %',
      array_to_string(v_missing, ', ');
  end if;

  if v_status = 'awaiting_activation' then
    return query select v_status, v_tier, true;
    return;
  end if;
  if v_status not in ('onboarding', 'prospect') then
    raise exception 'ONBOARDING_LOCKED: this carrier cannot submit assessment activation from its current state';
  end if;

  update public.clients
  set tier = 'assessment'::public.client_tier,
      status = 'awaiting_activation'::public.client_status,
      updated_at = now()
  where id = p_client_id;

  insert into public.activity_log (
    client_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    p_client_id,
    p_user_id,
    'assessment_activation_requested',
    'clients',
    p_client_id,
    'Client submitted the Assessment profile for GEIA payment confirmation and activation',
    jsonb_build_object(
      'tier', 'assessment',
      'from_status', v_status,
      'to_status', 'awaiting_activation',
      'requires_staff_action', true,
      'source', 'onboarding_step_4'
    )
  );

  return query select 'awaiting_activation', 'assessment', false;
end;
$function$;

create or replace function public.activate_assessment_client_v1(
  p_client_id uuid,
  p_user_id uuid
)
returns table (
  result_status text,
  result_tier text,
  already_active boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_status text;
  v_tier text;
begin
  select c.status::text, c.tier::text
    into v_status, v_tier
  from public.clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_NOT_FOUND: client was not found';
  end if;
  if v_tier <> 'assessment' then
    raise exception 'ASSESSMENT_REQUIRED: recurring tiers activate through paid Stripe checkout';
  end if;
  if v_status = 'active' then
    return query select v_status, v_tier, true;
    return;
  end if;
  if v_status <> 'awaiting_activation' then
    raise exception 'AWAITING_ACTIVATION_REQUIRED: the client must submit onboarding before staff activation';
  end if;

  update public.clients
  set status = 'active'::public.client_status,
      updated_at = now()
  where id = p_client_id;

  insert into public.activity_log (
    client_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    p_client_id,
    p_user_id,
    'client_activated_by_staff',
    'clients',
    p_client_id,
    'GEIA staff confirmed payment and activated the client Assessment',
    jsonb_build_object(
      'tier', 'assessment',
      'from_status', 'awaiting_activation',
      'to_status', 'active',
      'source', 'console'
    )
  );

  return query select 'active', 'assessment', false;
end;
$function$;

create or replace function public.activate_paid_subscription_v1(
  p_client_id uuid,
  p_tier public.client_tier,
  p_subscription_id text,
  p_customer_id text,
  p_mrr numeric,
  p_source text,
  p_user_id uuid default null
)
returns table (
  result_status text,
  result_tier text,
  already_active boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_status text;
  v_tier text;
  v_agreement_accepted boolean;
  v_already_active boolean;
  v_primary_contact text;
  v_phone text;
  v_vehicle_types text[];
  v_operating_states text[];
  v_operating_radius text;
  v_driver_count integer;
  v_citation_answer boolean;
  v_missing text[] := array[]::text[];
begin
  if p_tier::text not in ('monitor', 'remediate', 'total_safety') then
    raise exception 'INVALID_SUBSCRIPTION_TIER: Assessment does not use recurring checkout';
  end if;
  if nullif(btrim(p_subscription_id), '') is null
     or nullif(btrim(p_customer_id), '') is null then
    raise exception 'STRIPE_IDENTIFIERS_REQUIRED: checkout lacks subscription or customer data';
  end if;
  if p_mrr is null or p_mrr < 0 then
    raise exception 'INVALID_MRR: checkout amount must be a non-negative value';
  end if;

  select
    c.status::text,
    c.tier::text,
    c.service_agreement_accepted,
    c.primary_contact,
    c.phone,
    c.vehicle_types,
    c.operating_states,
    c.operating_radius,
    c.driver_count,
    c.citation_dismissed_last_24_months
    into
      v_status,
      v_tier,
      v_agreement_accepted,
      v_primary_contact,
      v_phone,
      v_vehicle_types,
      v_operating_states,
      v_operating_radius,
      v_driver_count,
      v_citation_answer
  from public.clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_NOT_FOUND: checkout client was not found';
  end if;
  if v_tier is null then
    raise exception 'CLIENT_TIER_REQUIRED: GEIA must assign a tier before checkout';
  end if;
  if v_tier <> p_tier::text then
    raise exception 'TIER_MISMATCH: checkout tier does not match the client selected tier';
  end if;
  if v_status not in ('onboarding', 'prospect', 'active') then
    raise exception 'ONBOARDING_LOCKED: checkout cannot activate this client lifecycle state';
  end if;
  if v_status <> 'active' then
    if nullif(btrim(coalesce(v_primary_contact, '')), '') is null
       or lower(btrim(v_primary_contact)) = any(array[
         'pending onboarding', 'pending invite', 'invite pending',
         'onboarding contact pending', 'to be provided', 'tbd'
       ]) then
      v_missing := array_append(v_missing, 'primary contact name');
    end if;
    if nullif(btrim(coalesce(v_phone, '')), '') is null then
      v_missing := array_append(v_missing, 'contact phone');
    end if;
    if coalesce(cardinality(v_vehicle_types), 0) = 0 then
      v_missing := array_append(v_missing, 'vehicle types');
    end if;
    if coalesce(cardinality(v_operating_states), 0) = 0 then
      v_missing := array_append(v_missing, 'operating states');
    end if;
    if nullif(btrim(coalesce(v_operating_radius, '')), '') is null then
      v_missing := array_append(v_missing, 'operating radius');
    end if;
    if v_driver_count is null or v_driver_count < 1 then
      v_missing := array_append(v_missing, 'billing driver count');
    end if;
    if v_citation_answer is null then
      v_missing := array_append(v_missing, 'roadside-ticket answer');
    end if;
    if v_agreement_accepted is not true then
      v_missing := array_append(v_missing, 'service agreement');
    end if;
    if cardinality(v_missing) > 0 then
      raise exception 'ONBOARDING_PROFILE_INCOMPLETE: still needed: %',
        array_to_string(v_missing, ', ');
    end if;
  end if;

  v_already_active := v_status = 'active';

  insert into public.subscriptions (
    client_id,
    tier,
    status,
    mrr,
    billing_cycle,
    stripe_customer_id,
    stripe_subscription_id
  ) values (
    p_client_id,
    p_tier,
    'active'::public.subscription_status,
    p_mrr,
    'monthly',
    p_customer_id,
    p_subscription_id
  )
  on conflict (client_id) do update
  set tier = excluded.tier,
      status = excluded.status,
      mrr = excluded.mrr,
      billing_cycle = excluded.billing_cycle,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id;

  if not v_already_active then
    update public.clients
    set tier = p_tier,
        status = 'active'::public.client_status,
        updated_at = now()
    where id = p_client_id;

    insert into public.activity_log (
      client_id,
      user_id,
      action_type,
      entity_type,
      entity_id,
      description,
      metadata
    ) values (
      p_client_id,
      p_user_id,
      'subscription_activated',
      'clients',
      p_client_id,
      format('Paid %s subscription activated through Stripe', p_tier::text),
      jsonb_build_object(
        'tier', p_tier::text,
        'from_status', v_status,
        'to_status', 'active',
        'source', p_source
      )
    );
  end if;

  return query select 'active', p_tier::text, v_already_active;
end;
$function$;

revoke all on function public.change_client_onboarding_tier_v1(
  uuid, uuid, public.client_tier
) from public, anon, authenticated;
revoke all on function public.submit_assessment_activation_v1(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.activate_assessment_client_v1(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.activate_paid_subscription_v1(
  uuid, public.client_tier, text, text, numeric, text, uuid
) from public, anon, authenticated;

grant execute on function public.change_client_onboarding_tier_v1(
  uuid, uuid, public.client_tier
) to service_role;
grant execute on function public.submit_assessment_activation_v1(
  uuid, uuid
) to service_role;
grant execute on function public.activate_assessment_client_v1(
  uuid, uuid
) to service_role;
grant execute on function public.activate_paid_subscription_v1(
  uuid, public.client_tier, text, text, numeric, text, uuid
) to service_role;
