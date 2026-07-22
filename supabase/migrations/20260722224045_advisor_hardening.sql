-- Advisor hardening, scoped to the 2026-07-22 authorization.
-- This migration deliberately leaves all backup tables and unrelated findings alone.

-- Pin every function currently reported with a mutable search_path. Function bodies
-- use only schema-qualified objects so an empty path is safe and deterministic.
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT app_user.client_id
  FROM public.users AS app_user
  WHERE app_user.id = (SELECT auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT app_user.role
  FROM public.users AS app_user
  WHERE app_user.id = (SELECT auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_geia_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    public.get_user_role() IN (
      'geia_admin'::public.user_role,
      'geia_staff'::public.user_role
    ),
    false
  );
$function$;

-- Anonymous HTTP routes use server-side service-role clients and do not call these
-- functions directly. Authenticated RLS still requires get_user_client_id/is_geia_staff.
REVOKE EXECUTE ON FUNCTION public.get_user_client_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_geia_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_client_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_geia_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role, supabase_auth_admin;

-- Consolidate the common client-read + staff-all policy shape. Separating staff writes
-- by action leaves exactly one permissive policy for each authenticated role/action.
DO $migration$
DECLARE
  policy_group record;
BEGIN
  FOR policy_group IN
    SELECT *
    FROM (VALUES
      ('action_items', 'ai_client', 'ai_staff', 'ai',
        'client_id = (SELECT public.get_user_client_id())'),
      ('activity_log', 'log_client', 'log_staff', 'log',
        'client_id = (SELECT public.get_user_client_id())'),
      ('burden_snapshots', 'bs_client', 'bs_staff', 'bs',
        'client_id = (SELECT public.get_user_client_id())'),
      ('carrier_profiles', 'cp_client', 'cp_staff', 'cp',
        'client_id = (SELECT public.get_user_client_id())'),
      ('clearinghouse_records', 'ch_client', 'ch_staff', 'ch',
        'client_id = (SELECT public.get_user_client_id())'),
      ('client_requests', 'client_requests_client_select', 'client_requests_staff', 'client_requests',
        'client_id = (SELECT public.get_user_client_id())'),
      ('clients', 'clients_client', 'clients_staff', 'clients',
        'id = (SELECT public.get_user_client_id())'),
      ('cpdp_cases', 'cpdp_client', 'cpdp_staff', 'cpdp',
        'client_id = (SELECT public.get_user_client_id())'),
      ('crashes', 'crash_client', 'crash_staff', 'crash',
        'client_id = (SELECT public.get_user_client_id())'),
      ('dataq_cases', 'dq_client', 'dq_staff', 'dq',
        'client_id = (SELECT public.get_user_client_id())'),
      ('driver_documents', 'drvdoc_client', 'drvdoc_staff', 'drvdoc',
        'client_id = (SELECT public.get_user_client_id())'),
      ('drivers', 'drv_client', 'drv_staff', 'drv',
        'client_id = (SELECT public.get_user_client_id())'),
      ('inspections', 'insp_client', 'insp_staff', 'insp',
        'client_id = (SELECT public.get_user_client_id())'),
      ('mcs150_updates', 'mcs_client', 'mcs_staff', 'mcs',
        'client_id = (SELECT public.get_user_client_id())'),
      ('reports', 'rep_client', 'rep_staff', 'rep',
        'client_id = (SELECT public.get_user_client_id()) AND status = ''sent''::public.report_status'),
      ('score_snapshots', 'ss_client', 'ss_staff', 'ss',
        'client_id = (SELECT public.get_user_client_id())'),
      ('subscriptions', 'subs_client', 'subs_staff', 'subs',
        'client_id = (SELECT public.get_user_client_id())'),
      ('users', 'users_self', 'users_staff', 'users',
        'id = (SELECT auth.uid())'),
      ('vehicle_maintenance', 'vm_client', 'vm_staff', 'vm',
        'client_id = (SELECT public.get_user_client_id())'),
      ('vehicles', 'veh_client', 'veh_staff', 'veh',
        'client_id = (SELECT public.get_user_client_id())'),
      ('violations', 'viol_client', 'viol_staff', 'viol',
        'client_id = (SELECT public.get_user_client_id())')
    ) AS configured(
      table_name,
      old_client_policy,
      old_staff_policy,
      new_prefix,
      client_expression
    )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.old_client_policy,
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.old_staff_policy,
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.new_prefix || '_read',
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.new_prefix || '_staff_insert',
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.new_prefix || '_staff_update',
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_group.new_prefix || '_staff_delete',
      policy_group.table_name
    );

    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((%s) OR (SELECT public.is_geia_staff()))',
      policy_group.new_prefix || '_read',
      policy_group.table_name,
      policy_group.client_expression
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_geia_staff()))',
      policy_group.new_prefix || '_staff_insert',
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_geia_staff())) WITH CHECK ((SELECT public.is_geia_staff()))',
      policy_group.new_prefix || '_staff_update',
      policy_group.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_geia_staff()))',
      policy_group.new_prefix || '_staff_delete',
      policy_group.table_name
    );
  END LOOP;
END;
$migration$;

-- Alerts allow clients to update their own rows as well as staff to manage all rows.
DROP POLICY IF EXISTS alert_client ON public.alerts;
DROP POLICY IF EXISTS alert_client_update ON public.alerts;
DROP POLICY IF EXISTS alert_staff ON public.alerts;
DROP POLICY IF EXISTS alert_read ON public.alerts;
DROP POLICY IF EXISTS alert_update ON public.alerts;
DROP POLICY IF EXISTS alert_staff_insert ON public.alerts;
DROP POLICY IF EXISTS alert_staff_delete ON public.alerts;

CREATE POLICY alert_read ON public.alerts
  FOR SELECT TO authenticated
  USING (
    client_id = (SELECT public.get_user_client_id())
    OR (SELECT public.is_geia_staff())
  );
CREATE POLICY alert_update ON public.alerts
  FOR UPDATE TO authenticated
  USING (
    client_id = (SELECT public.get_user_client_id())
    OR (SELECT public.is_geia_staff())
  )
  WITH CHECK (
    client_id = (SELECT public.get_user_client_id())
    OR (SELECT public.is_geia_staff())
  );
CREATE POLICY alert_staff_insert ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_geia_staff()));
CREATE POLICY alert_staff_delete ON public.alerts
  FOR DELETE TO authenticated
  USING ((SELECT public.is_geia_staff()));

-- Documents allow clients to read and insert their own rows; other writes are staff-only.
DROP POLICY IF EXISTS doc_client ON public.documents;
DROP POLICY IF EXISTS doc_client_insert ON public.documents;
DROP POLICY IF EXISTS doc_staff ON public.documents;
DROP POLICY IF EXISTS doc_read ON public.documents;
DROP POLICY IF EXISTS doc_insert ON public.documents;
DROP POLICY IF EXISTS doc_staff_update ON public.documents;
DROP POLICY IF EXISTS doc_staff_delete ON public.documents;

CREATE POLICY doc_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    client_id = (SELECT public.get_user_client_id())
    OR (SELECT public.is_geia_staff())
  );
CREATE POLICY doc_insert ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id = (SELECT public.get_user_client_id())
    OR (SELECT public.is_geia_staff())
  );
CREATE POLICY doc_staff_update ON public.documents
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_geia_staff()))
  WITH CHECK ((SELECT public.is_geia_staff()));
CREATE POLICY doc_staff_delete ON public.documents
  FOR DELETE TO authenticated
  USING ((SELECT public.is_geia_staff()));

-- Preserve the existing public token-read policy exactly. The public page/API uses a
-- service client, but removing this table policy would change effective access and is
-- outside the consolidation-only authorization.
DROP POLICY IF EXISTS dqer_staff ON public.dataq_evidence_request;
DROP POLICY IF EXISTS dqer_staff_insert ON public.dataq_evidence_request;
DROP POLICY IF EXISTS dqer_staff_update ON public.dataq_evidence_request;
DROP POLICY IF EXISTS dqer_staff_delete ON public.dataq_evidence_request;

CREATE POLICY dqer_staff_insert ON public.dataq_evidence_request
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_geia_staff()));
CREATE POLICY dqer_staff_update ON public.dataq_evidence_request
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_geia_staff()))
  WITH CHECK ((SELECT public.is_geia_staff()));
CREATE POLICY dqer_staff_delete ON public.dataq_evidence_request
  FOR DELETE TO authenticated
  USING ((SELECT public.is_geia_staff()));

-- These staff-only policies did not overlap, but must target authenticated after anon
-- execute is revoked from is_geia_staff; the allowed row set remains unchanged.
DO $migration$
DECLARE
  staff_policy record;
BEGIN
  FOR staff_policy IN
    SELECT *
    FROM (VALUES
      ('case_evidence', 'ce_staff'),
      ('client_credentials', 'geia_staff_only'),
      ('cpdp_evidence', 'cpdpev_staff'),
      ('dataq_evidence', 'dqev_staff'),
      ('fmcsa_ingest_files', 'fmcsa_ingest_files_staff'),
      ('fmcsa_violation_reference', 'fvr_staff'),
      ('inspection_vehicles', 'iv_staff')
    ) AS configured(table_name, policy_name)
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      staff_policy.policy_name,
      staff_policy.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((SELECT public.is_geia_staff())) WITH CHECK ((SELECT public.is_geia_staff()))',
      staff_policy.policy_name,
      staff_policy.table_name
    );
  END LOOP;
END;
$migration$;

-- Keep the UNIQUE-constraint-backed carrier_profiles_client_id_key index.
DROP INDEX IF EXISTS public.carrier_profiles_client_id_unique;
