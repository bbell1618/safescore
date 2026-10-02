-- Owner approval of client-facing legal wording (terms + filing authorization).
-- An approval covers only the exact text whose hash it records, so any later
-- wording change needs a fresh approval. Service-role access only.
create table if not exists public.legal_approvals (
  id uuid primary key default gen_random_uuid(),
  document text not null,
  content_hash text not null,
  approved_by_name text not null,
  approved_at timestamptz not null default now(),
  recorded_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists legal_approvals_document_hash_idx on public.legal_approvals (document, content_hash);
alter table public.legal_approvals enable row level security;
