-- Atomic staff-confirmed recurring activation. Staff authenticate in the API;
-- this function is callable only with the service role and never creates or
-- changes Stripe identifiers.

create or replace function public.activate_staff_confirmed_subscription_v1(
  p_client_id uuid,
  p_user_id uuid
)
returns table (
  result_status text,
  result_tier text,
  already_active boolean,
  result_mrr numeric
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
  v_stripe_customer_id text;
  v_stripe_subscription_id text;
  v_existing_mrr numeric;
  v_mrr numeric;
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
    raise exception 'CLIENT_NOT_FOUND: client was not found';
  end if;
  if v_tier is null then
    raise exception 'CLIENT_TIER_REQUIRED: assign a service tier before activation';
  end if;
  if v_tier not in ('monitor', 'remediate', 'total_safety') then
    raise exception 'INVALID_SUBSCRIPTION_TIER: Assessment uses the one-time activation path';
  end if;

  v_mrr := case v_tier
    when 'monitor' then 199
    when 'remediate' then 599
    when 'total_safety' then 999 + (coalesce(v_driver_count, 0) * 29)
  end;

  if v_status = 'active' then
    select s.mrr
      into v_existing_mrr
    from public.subscriptions s
    where s.client_id = p_client_id;

    return query select
      'active',
      v_tier,
      true,
      coalesce(v_existing_mrr, v_mrr);
    return;
  end if;
  if v_status not in ('onboarding', 'prospect') then
    raise exception 'ONBOARDING_LOCKED: subscription cannot be activated from the current lifecycle state';
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

  select s.stripe_customer_id, s.stripe_subscription_id
    into v_stripe_customer_id, v_stripe_subscription_id
  from public.subscriptions s
  where s.client_id = p_client_id
  for update;

  if nullif(btrim(coalesce(v_stripe_customer_id, '')), '') is not null
     or nullif(btrim(coalesce(v_stripe_subscription_id, '')), '') is not null then
    raise exception 'STRIPE_BILLING_PRESENT: complete activation through Stripe sync instead of manual confirmation';
  end if;

  insert into public.subscriptions (
    client_id,
    tier,
    status,
    mrr,
    billing_cycle
  ) values (
    p_client_id,
    v_tier::public.client_tier,
    'active'::public.subscription_status,
    v_mrr,
    'monthly'
  )
  on conflict (client_id) do update
  set tier = excluded.tier,
      status = excluded.status,
      mrr = excluded.mrr,
      billing_cycle = excluded.billing_cycle;

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
    format(
      'GEIA staff confirmed payment and activated the %s subscription',
      initcap(replace(v_tier, '_', ' '))
    ),
    jsonb_build_object(
      'tier', v_tier,
      'from_status', v_status,
      'to_status', 'active',
      'source', 'console_manual_payment',
      'billing_cycle', 'monthly',
      'mrr', v_mrr,
      'billing_driver_count', v_driver_count,
      'stripe_mutated', false
    )
  );

  return query select 'active', v_tier, false, v_mrr;
end;
$function$;

revoke all on function public.activate_staff_confirmed_subscription_v1(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.activate_staff_confirmed_subscription_v1(
  uuid, uuid
) to service_role;
