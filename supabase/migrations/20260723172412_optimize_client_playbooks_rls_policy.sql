do $policy$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_playbooks'
      and policyname = 'client_playbooks_staff_select'
  ) then
    alter policy client_playbooks_staff_select
      on public.client_playbooks
      using ((select public.is_geia_staff()));
  else
    create policy client_playbooks_staff_select
      on public.client_playbooks
      for select
      to authenticated
      using ((select public.is_geia_staff()));
  end if;
end
$policy$;
