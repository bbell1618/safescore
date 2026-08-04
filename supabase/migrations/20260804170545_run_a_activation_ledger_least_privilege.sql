-- Supabase project default privileges grant service_role table capabilities
-- beyond what this internal ledger needs. Retain CRUD while removing schema-
-- management/table-destruction capabilities from this one new table.
revoke truncate, references, trigger
  on table public.client_activation_initializations
  from service_role;
