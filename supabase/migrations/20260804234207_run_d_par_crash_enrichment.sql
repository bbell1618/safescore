-- Run D: crash-source enrichment plus auditable PAR intake/review state.
-- Existing public-source, case, and document rows are preserved.

alter table public.crashes
  add column if not exists par_document_id uuid,
  add column if not exists par_document_source text,
  add column if not exists par_received_at timestamptz,
  add column if not exists par_local_report_number text,
  add column if not exists par_content_sha256 text,
  add column if not exists report_sequence_number text,
  add column if not exists location text,
  add column if not exists trafficway text,
  add column if not exists access_control_desc text,
  add column if not exists road_surface_condition text,
  add column if not exists weather_condition text,
  add column if not exists light_condition text,
  add column if not exists vehicle_configuration text,
  add column if not exists severity_weight integer,
  add column if not exists time_weight integer,
  add column if not exists citation_issued boolean,
  add column if not exists fmcsa_not_preventable boolean,
  add column if not exists vehicle_identification_number text,
  add column if not exists vehicle_license_number text,
  add column if not exists vehicle_license_state text,
  add column if not exists federal_recordable boolean,
  add column if not exists state_recordable boolean,
  add column if not exists fmcsa_crash_sources_fetched_at timestamptz;

alter table public.cpdp_evidence
  add column if not exists document_id uuid;

alter table public.cpdp_cases
  add column if not exists par_ai_assessment jsonb,
  add column if not exists par_review_assessment jsonb,
  add column if not exists par_assessment_status text not null default 'awaiting_par',
  add column if not exists par_assessment_model text,
  add column if not exists par_assessment_error text,
  add column if not exists par_assessment_attempted_at timestamptz,
  add column if not exists par_assessment_document_id uuid,
  add column if not exists par_reviewed_at timestamptz,
  add column if not exists par_reviewed_by uuid,
  add column if not exists par_assessment_overrides jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crashes_par_document_id_fkey'
      and conrelid = 'public.crashes'::regclass
  ) then
    alter table public.crashes
      add constraint crashes_par_document_id_fkey
      foreign key (par_document_id) references public.documents(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cpdp_evidence_document_id_fkey'
      and conrelid = 'public.cpdp_evidence'::regclass
  ) then
    alter table public.cpdp_evidence
      add constraint cpdp_evidence_document_id_fkey
      foreign key (document_id) references public.documents(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cpdp_cases_par_assessment_document_id_fkey'
      and conrelid = 'public.cpdp_cases'::regclass
  ) then
    alter table public.cpdp_cases
      add constraint cpdp_cases_par_assessment_document_id_fkey
      foreign key (par_assessment_document_id) references public.documents(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cpdp_cases_par_reviewed_by_fkey'
      and conrelid = 'public.cpdp_cases'::regclass
  ) then
    alter table public.cpdp_cases
      add constraint cpdp_cases_par_reviewed_by_fkey
      foreign key (par_reviewed_by) references public.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cpdp_cases_par_assessment_status_check'
      and conrelid = 'public.cpdp_cases'::regclass
  ) then
    alter table public.cpdp_cases
      add constraint cpdp_cases_par_assessment_status_check
      check (par_assessment_status in (
        'awaiting_par', 'assessing', 'ready_for_review', 'approved', 'failed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crashes_par_document_source_check'
      and conrelid = 'public.crashes'::regclass
  ) then
    alter table public.crashes
      add constraint crashes_par_document_source_check
      check (par_document_source is null or par_document_source in ('manual', 'lexisnexis'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cpdp_cases_ai_eligibility_verdict_check'
      and conrelid = 'public.cpdp_cases'::regclass
  ) then
    alter table public.cpdp_cases
      add constraint cpdp_cases_ai_eligibility_verdict_check
      check (ai_eligibility_verdict is null or ai_eligibility_verdict in (
        'ELIGIBLE', 'INDETERMINATE', 'NOT_ELIGIBLE'
      ));
  end if;
end
$$;

create unique index if not exists cpdp_evidence_one_par_per_case_idx
  on public.cpdp_evidence(case_id)
  where doc_type = 'police_report';

create index if not exists crashes_par_document_id_idx
  on public.crashes(par_document_id)
  where par_document_id is not null;

create index if not exists cpdp_evidence_document_id_idx
  on public.cpdp_evidence(document_id)
  where document_id is not null;

create index if not exists cpdp_cases_par_assessment_document_id_idx
  on public.cpdp_cases(par_assessment_document_id)
  where par_assessment_document_id is not null;

create index if not exists cpdp_cases_par_reviewed_by_idx
  on public.cpdp_cases(par_reviewed_by)
  where par_reviewed_by is not null;

create unique index if not exists cpdp_cases_one_per_crash_idx
  on public.cpdp_cases(crash_id);

create or replace function public.approve_cpdp_par_assessment_v1(
  p_case_id uuid,
  p_reviewer_id uuid,
  p_review_assessment jsonb,
  p_eligible_types text[],
  p_final_narrative text,
  p_overrides jsonb default '[]'::jsonb
)
returns table(case_id uuid, crash_id uuid, client_id uuid, approved_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_case public.cpdp_cases%rowtype;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.users
    where id = p_reviewer_id and role in ('geia_admin', 'geia_staff')
  ) then
    raise exception 'Reviewer must be a GEIA staff user';
  end if;

  select * into v_case
  from public.cpdp_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'CPDP case not found';
  end if;
  if v_case.par_ai_assessment is null
     or v_case.par_assessment_status <> 'ready_for_review'
     or v_case.par_assessment_document_id is null then
    raise exception 'A completed PAR assessment is required before approval';
  end if;
  if not exists (
    select 1 from public.crashes
    where id = v_case.crash_id
      and par_document_id = v_case.par_assessment_document_id
  ) then
    raise exception 'The assessed PAR is no longer linked to this crash';
  end if;
  if coalesce(p_review_assessment #>> '{identity,confirmed}', 'false') <> 'true' then
    raise exception 'PAR identity must be confirmed by the reviewer';
  end if;
  if cardinality(coalesce(p_eligible_types, array[]::text[])) > 0
     and nullif(btrim(coalesce(p_final_narrative, '')), '') is null then
    raise exception 'A grounded final narrative is required for an eligible assessment';
  end if;

  update public.cpdp_cases
  set par_review_assessment = p_review_assessment,
      par_assessment_overrides = coalesce(p_overrides, '[]'::jsonb),
      par_assessment_status = 'approved',
      par_reviewed_at = v_now,
      par_reviewed_by = p_reviewer_id,
      par_identity_confirmed = true,
      par_confirmed_at = v_now,
      par_confirmed_by = p_reviewer_id::text,
      narrative_evidence_verified = true,
      narrative_verified_at = v_now,
      narrative_verified_by = p_reviewer_id::text,
      cpdp_eligible_types = coalesce(p_eligible_types, array[]::text[]),
      final_narrative = nullif(btrim(coalesce(p_final_narrative, '')), ''),
      updated_at = v_now
  where id = p_case_id;

  update public.crashes
  set cpdp_eligible = cardinality(coalesce(p_eligible_types, array[]::text[])) > 0,
      cpdp_eligible_types = coalesce(p_eligible_types, array[]::text[]),
      ai_assessed_at = v_now
  where id = v_case.crash_id;

  insert into public.activity_log (
    client_id, user_id, action_type, entity_type, entity_id, description, metadata
  ) values (
    v_case.client_id,
    p_reviewer_id,
    'cpdp_par_assessment_approved',
    'cpdp_cases',
    p_case_id,
    'PAR identity, CPDP answers, and grounded narrative approved by a GEIA reviewer',
    jsonb_build_object(
      'crash_id', v_case.crash_id,
      'document_id', v_case.par_assessment_document_id,
      'eligible_types', coalesce(p_eligible_types, array[]::text[]),
      'overrides', coalesce(p_overrides, '[]'::jsonb)
    )
  );

  return query select p_case_id, v_case.crash_id, v_case.client_id, v_now;
end
$$;

revoke all on function public.approve_cpdp_par_assessment_v1(
  uuid, uuid, jsonb, text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.approve_cpdp_par_assessment_v1(
  uuid, uuid, jsonb, text[], text, jsonb
) to service_role;
