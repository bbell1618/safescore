-- One-time authorized replacement: invite validation and mutation are
-- server-only service-role operations. No anon/authenticated table policy.
drop policy if exists "Service role full access on client_invites"
  on public.client_invites;

drop policy if exists "Service role only on client_invites"
  on public.client_invites;

create policy "Service role only on client_invites"
  on public.client_invites
  for all
  to service_role
  using (true)
  with check (true);
