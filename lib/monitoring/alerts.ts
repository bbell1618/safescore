import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNewViolationAlert } from "@/lib/email/client";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import {
  planRefreshAlerts,
  type AlertSeverity,
  type MonitoringAlertCandidate,
  type MonitoringCrashRow,
  type MonitoringViolationRow,
} from "./alert-planner";

export type CreatedAlert = MonitoringAlertCandidate & { id: string };

export type CaseAlertInput = {
  clientId: string;
  caseType: "DataQ" | "CPDP";
  caseId: string;
  caseNumber: string | null;
  status: string;
  outcome?: string | null;
};

export async function emitAlertOnce(
  supabase: SupabaseClient,
  candidate: {
    clientId: string;
    type: string;
    severity: AlertSeverity;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
  }
): Promise<CreatedAlert | null> {
  const { data: existing, error: lookupError } = await supabase
    .from("alerts")
    .select("id")
    .eq("client_id", candidate.clientId)
    .eq("entity_type", candidate.entityType)
    .eq("entity_id", candidate.entityId)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Unable to check alert dedupe state: ${lookupError.message}`);
  }
  if (existing) return null;

  const { data, error } = await supabase
    .from("alerts")
    .insert({
      client_id: candidate.clientId,
      type: candidate.type,
      severity: candidate.severity,
      title: candidate.title,
      message: candidate.message,
      entity_type: candidate.entityType,
      entity_id: candidate.entityId,
    })
    .select("id")
    .single();

  // The unique partial index is the race-safe second half of the pre-insert guard.
  if (error?.code === "23505") return null;
  if (error || !data) {
    throw new Error(`Unable to create alert: ${error?.message ?? "insert returned no row"}`);
  }

  return { ...candidate, id: data.id } as CreatedAlert;
}

async function loadViolationRows(
  supabase: SupabaseClient,
  ids: string[]
): Promise<MonitoringViolationRow[]> {
  if (ids.length === 0) return [];
  const rows: MonitoringViolationRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from("violations")
      .select(
        "id, violation_code, violation_description, basic_category, severity_weight, oos_violation, inspections(inspection_date)"
      )
      .in("id", ids.slice(offset, offset + 100));
    if (error) throw new Error(`Unable to load new violations for alerts: ${error.message}`);
    rows.push(...((data ?? []) as unknown as MonitoringViolationRow[]));
  }
  return rows;
}

async function loadCrashRows(
  supabase: SupabaseClient,
  ids: string[]
): Promise<MonitoringCrashRow[]> {
  if (ids.length === 0) return [];
  const rows: MonitoringCrashRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from("crashes")
      .select("id, report_number, crash_date, city, state, fatalities, injuries, tow_away")
      .in("id", ids.slice(offset, offset + 100));
    if (error) throw new Error(`Unable to load new crashes for alerts: ${error.message}`);
    rows.push(...((data ?? []) as MonitoringCrashRow[]));
  }
  return rows;
}

export async function emitRefreshAlerts(
  supabase: SupabaseClient,
  input: { clientId: string; newViolationIds: string[]; newCrashIds: string[] }
): Promise<{
  created: CreatedAlert[];
  violations: MonitoringViolationRow[];
  crashes: MonitoringCrashRow[];
}> {
  const [violations, crashes] = await Promise.all([
    loadViolationRows(supabase, input.newViolationIds),
    loadCrashRows(supabase, input.newCrashIds),
  ]);
  const planned = planRefreshAlerts({ ...input, violations, crashes });
  const created: CreatedAlert[] = [];
  for (const candidate of planned) {
    const alert = await emitAlertOnce(supabase, candidate);
    if (alert) created.push(alert);
  }
  return { created, violations, crashes };
}

async function sendViolationEmailRows(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    violationIds: string[];
    violations: MonitoringViolationRow[];
    companyName: string;
    dotNumber: string;
  }
): Promise<number> {
  const violationIds = new Set(input.violationIds);
  if (violationIds.size === 0) return 0;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("tier")
    .eq("id", input.clientId)
    .single();
  if (clientError || !client) {
    throw new Error(
      `Unable to verify violation-alert entitlement: ${clientError?.message ?? "client not found"}`
    );
  }
  if (!tierHasFeature(normalizeClientTier(client.tier), "monitoring_alerts")) {
    return 0;
  }

  const { data: recipient, error } = await supabase
    .from("users")
    .select("email")
    .eq("client_id", input.clientId)
    .eq("role", "client_user")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to load violation-alert recipient: ${error.message}`);
  if (!recipient?.email) return 0;

  let attempted = 0;
  for (const violation of input.violations) {
    if (!violationIds.has(violation.id)) continue;
    const inspection = Array.isArray(violation.inspections)
      ? violation.inspections[0] ?? null
      : violation.inspections;
    await sendNewViolationAlert({
      to: recipient.email,
      companyName: input.companyName,
      dotNumber: input.dotNumber,
      violationCode: violation.violation_code ?? "Unknown code",
      description: violation.violation_description ?? "No description supplied",
      inspectionDate: inspection?.inspection_date ?? "Unknown",
      basicCategory: violation.basic_category ?? "unknown",
      severityWeight: violation.severity_weight ?? 0,
      portalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"}/portal/safety`,
    });
    attempted += 1;
  }
  return attempted;
}

export async function sendRefreshViolationEmails(
  supabase: SupabaseClient,
  input: {
    created: CreatedAlert[];
    violations: MonitoringViolationRow[];
    companyName: string;
    dotNumber: string;
  }
): Promise<number> {
  const createdViolationAlerts = input.created.filter(
    (alert) => alert.type === "new_violation"
  );
  if (createdViolationAlerts.length === 0) return 0;
  return sendViolationEmailRows(supabase, {
    clientId: createdViolationAlerts[0].clientId,
    violationIds: createdViolationAlerts.map((alert) => alert.entityId),
    violations: input.violations,
    companyName: input.companyName,
    dotNumber: input.dotNumber,
  });
}

/** Preserve the console rerun's historical baseline suppression and email-only behavior. */
export async function sendViolationEmailsForIds(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    violationIds: string[];
    companyName: string;
    dotNumber: string;
  }
): Promise<number> {
  if (input.violationIds.length === 0) return 0;
  const violations = await loadViolationRows(supabase, input.violationIds);
  return sendViolationEmailRows(supabase, {
    clientId: input.clientId,
    violationIds: input.violationIds,
    violations,
    companyName: input.companyName,
    dotNumber: input.dotNumber,
  });
}

export async function emitCaseResolutionAlert(
  supabase: SupabaseClient,
  input: CaseAlertInput
): Promise<CreatedAlert | null> {
  const entityType = input.caseType === "DataQ" ? "dataq_cases" : "cpdp_cases";
  const isAdverse =
    input.status === "denied" || input.outcome === "preventable";
  const caseLabel = input.caseNumber ? ` ${input.caseNumber}` : "";
  const outcome = input.outcome ? ` with outcome ${input.outcome.replaceAll("_", " ")}` : "";
  return emitAlertOnce(supabase, {
    clientId: input.clientId,
    type: "case_determination",
    severity: isAdverse ? "critical" : "info",
    title: `${input.caseType} case determination received`,
    message: `${input.caseType} case${caseLabel} moved to ${input.status.replaceAll("_", " ")}${outcome}. Review the determination in SafeScore.`,
    entityType,
    entityId: input.caseId,
  });
}
