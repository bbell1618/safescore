-- U10 Lane B evidence loop. This migration only adds nullable columns,
-- constraints, foreign keys, and indexes; existing request lifecycles remain
-- untouched in client_requests.status.

alter table public.clients
  add column if not exists citation_dismissed_last_24_months boolean;

alter table public.client_requests
  add column if not exists request_type text,
  add column if not exists evidence_class text,
  add column if not exists evidence_status text,
  add column if not exists violation_id uuid,
  add column if not exists why_copy text,
  add column if not exists potential_points integer,
  add column if not exists response jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists applied_at timestamptz,
  add column if not exists status_copy text;

alter table public.documents
  add column if not exists client_request_id uuid,
  add column if not exists violation_id uuid,
  add column if not exists case_type text,
  add column if not exists case_id uuid,
  add column if not exists evidence_class text,
  add column if not exists evidence_item_key text,
  add column if not exists evidence_analysis jsonb;

alter table public.dataq_evidence
  add column if not exists client_request_id uuid,
  add column if not exists document_id uuid,
  add column if not exists evidence_item_key text,
  add column if not exists storage_bucket text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_requests'::regclass
      and conname = 'client_requests_request_type_check'
  ) then
    alter table public.client_requests
      add constraint client_requests_request_type_check
      check (request_type in ('evidence', 'question') or request_type is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dataq_evidence'::regclass
      and conname = 'dataq_evidence_client_request_id_fkey'
  ) then
    alter table public.dataq_evidence
      add constraint dataq_evidence_client_request_id_fkey
      foreign key (client_request_id) references public.client_requests(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dataq_evidence'::regclass
      and conname = 'dataq_evidence_document_id_fkey'
  ) then
    alter table public.dataq_evidence
      add constraint dataq_evidence_document_id_fkey
      foreign key (document_id) references public.documents(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dataq_evidence'::regclass
      and conname = 'dataq_evidence_storage_bucket_check'
  ) then
    alter table public.dataq_evidence
      add constraint dataq_evidence_storage_bucket_check
      check (storage_bucket in ('documents', 'dataq-evidence') or storage_bucket is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_requests'::regclass
      and conname = 'client_requests_evidence_class_check'
  ) then
    alter table public.client_requests
      add constraint client_requests_evidence_class_check
      check (
        evidence_class in (
          'wrong-attribution',
          'duplicate',
          'citation-dismissed',
          'report-factual-error'
        ) or evidence_class is null
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_requests'::regclass
      and conname = 'client_requests_evidence_status_check'
  ) then
    alter table public.client_requests
      add constraint client_requests_evidence_status_check
      check (
        evidence_status in ('open', 'submitted', 'applied', 'insufficient')
        or evidence_status is null
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_requests'::regclass
      and conname = 'client_requests_potential_points_check'
  ) then
    alter table public.client_requests
      add constraint client_requests_potential_points_check
      check (potential_points >= 0 or potential_points is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_requests'::regclass
      and conname = 'client_requests_violation_id_fkey'
  ) then
    alter table public.client_requests
      add constraint client_requests_violation_id_fkey
      foreign key (violation_id) references public.violations(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_client_request_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_client_request_id_fkey
      foreign key (client_request_id) references public.client_requests(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_violation_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_violation_id_fkey
      foreign key (violation_id) references public.violations(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_case_type_check'
  ) then
    alter table public.documents
      add constraint documents_case_type_check
      check (case_type in ('dataq', 'cpdp') or case_type is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_evidence_class_check'
  ) then
    alter table public.documents
      add constraint documents_evidence_class_check
      check (
        evidence_class in (
          'wrong-attribution',
          'duplicate',
          'citation-dismissed',
          'report-factual-error'
        ) or evidence_class is null
      );
  end if;
end
$$;

create index if not exists idx_client_requests_lane_b_active
  on public.client_requests(client_id, evidence_status, created_at desc)
  where request_type in ('evidence', 'question');

create index if not exists idx_client_requests_violation_class
  on public.client_requests(violation_id, evidence_class, created_at desc)
  where violation_id is not null and evidence_class is not null;

create index if not exists idx_documents_client_request
  on public.documents(client_request_id, evidence_item_key, created_at desc)
  where client_request_id is not null;

create index if not exists idx_documents_violation
  on public.documents(violation_id, created_at desc)
  where violation_id is not null;

create unique index if not exists idx_dataq_evidence_typed_request_item
  on public.dataq_evidence(client_request_id, evidence_item_key);
