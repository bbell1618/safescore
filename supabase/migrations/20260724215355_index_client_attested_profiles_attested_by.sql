create index if not exists idx_client_attested_profiles_attested_by
  on public.client_attested_profiles (attested_by)
  where attested_by is not null;
