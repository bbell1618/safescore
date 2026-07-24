-- U8 hardening: one active truth-up per client and fail-closed table access.

create unique index if not exists idx_mcs150_updates_one_active_client
  on public.mcs150_updates (client_id)
  where status in ('draft', 'pending_review', 'submitted');

do $policies$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_attested_profiles'
      and policyname = 'client_attested_profiles_staff_only_guard'
  ) then
    create policy client_attested_profiles_staff_only_guard
      on public.client_attested_profiles
      as restrictive
      for select
      to authenticated
      using ((select public.is_geia_staff()));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mcs150_updates'
      and policyname = 'mcs150_updates_staff_only_guard'
  ) then
    create policy mcs150_updates_staff_only_guard
      on public.mcs150_updates
      as restrictive
      for select
      to authenticated
      using ((select public.is_geia_staff()));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_requests'
      and policyname = 'client_requests_mcs150_tier_guard'
  ) then
    create policy client_requests_mcs150_tier_guard
      on public.client_requests
      as restrictive
      for select
      to authenticated
      using (
        coalesce(category, '') <> 'mcs150_truth_up'
        or (select public.is_geia_staff())
        or exists (
          select 1
          from public.clients
          where clients.id = client_requests.client_id
            and clients.id = (select public.get_user_client_id())
            and clients.tier = 'total_safety'
        )
      );
  end if;
end
$policies$;
