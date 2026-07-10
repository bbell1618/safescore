alter table public.score_snapshots
  add column if not exists official_basics jsonb not null default '{}'::jsonb,
  add column if not exists source_file_hash text;

create table if not exists public.fmcsa_ingest_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_hash text not null,
  ingest_kind text not null check (ingest_kind in ('inspection_detail', 'all_basics')),
  filename text,
  parsed_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, file_hash)
);

alter table public.fmcsa_ingest_files enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fmcsa_ingest_files'
      and policyname = 'fmcsa_ingest_files_staff'
  ) then
    create policy fmcsa_ingest_files_staff on public.fmcsa_ingest_files
      for all using (is_geia_staff()) with check (is_geia_staff());
  end if;
end
$$;
