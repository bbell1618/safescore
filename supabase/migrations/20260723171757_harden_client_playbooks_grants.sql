revoke all privileges on table public.client_playbooks from anon;
revoke all privileges on table public.client_playbooks from authenticated;
grant select on table public.client_playbooks to authenticated;
grant all privileges on table public.client_playbooks to service_role;
