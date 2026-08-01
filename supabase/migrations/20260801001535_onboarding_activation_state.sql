-- Assessment onboarding has a deliberate handoff between client submission
-- and staff activation. Keep this distinct from both writable onboarding and
-- active portal access.
alter type public.client_status
  add value if not exists 'awaiting_activation' before 'active';
