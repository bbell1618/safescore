-- QF-199: emailed 6-digit sign-in codes. Rows are written and read only by the server (service role).
create table if not exists public.login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_codes_email_created_idx on public.login_codes (email, created_at desc);
alter table public.login_codes enable row level security;
revoke all on public.login_codes from anon, authenticated;
grant all on public.login_codes to service_role;
