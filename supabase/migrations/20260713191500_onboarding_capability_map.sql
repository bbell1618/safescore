alter table public.clients
  add column if not exists eld_provider text,
  add column if not exists safety_contact_name text,
  add column if not exists safety_contact_email text,
  add column if not exists standing_authorization boolean not null default false,
  add column if not exists standing_authorized_at timestamptz;

comment on column public.clients.driver_count is
  'Client-stated editable driver count used for billing. FMCSA/MCS-150 counts are reference only.';
comment on column public.clients.standing_authorization is
  'Client authorizes GEIA to access FMCSA data and file DataQs/CPDP on an ongoing basis.';
