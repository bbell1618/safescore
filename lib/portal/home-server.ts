import "server-only";

import { timeWeightFor } from "@/lib/analysis/basic-measure";
import {
  getCanonicalInspectionScope,
  type CanonicalInspectionScope,
} from "@/lib/fmcsa/canonical-inspection-scope";
import {
  preferredAuthorityStatus,
  type PortalHomeAuthority,
  type PortalHomeCase,
  type PortalHomeData,
  type PortalHomeRequest,
  type PortalHomeSnapshot,
  type PortalHomeWorkNote,
} from "@/lib/portal/home";
import { createServiceClient } from "@/lib/supabase/server";
import type { ClientTier } from "@/lib/supabase/types";
import { tierHasFeature } from "@/lib/tiers";

type SnapshotQueryRow = Omit<PortalHomeSnapshot, "per_basic"> & {
  per_basic: unknown;
};

type DataqCaseRow = {
  id: string;
  case_number: string | null;
  status: string;
  filed_date: string | null;
  updated_at: string;
};

type CpdpCaseRow = DataqCaseRow;

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
};

type ActivityRow = {
  id: string;
  action_type: string;
  description: string;
  created_at: string;
};

type EnrichmentRow = {
  source: string;
  fetched_at: string;
  data: unknown;
};

type InvestigationRow = {
  id: string;
  severity_weight: number | null;
  oos_violation: boolean | null;
  inspections:
    | {
        inspection_date: string | null;
        mcmis_inspection_id: string | null;
      }
    | Array<{
        inspection_date: string | null;
        mcmis_inspection_id: string | null;
      }>
    | null;
};

function queryError(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSnapshots(rows: SnapshotQueryRow[]): PortalHomeSnapshot[] {
  return rows.map((row) => ({
    ...row,
    per_basic: Array.isArray(row.per_basic)
      ? row.per_basic
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return null;
            }
            const record = item as Record<string, unknown>;
            const basicCategory =
              typeof record.basic_category === "string"
                ? record.basic_category
                : null;
            if (!basicCategory) return null;
            return {
              basic_category: basicCategory,
              violation_count: finiteNumber(record.violation_count),
              weighted_points: finiteNumber(record.weighted_points),
            };
          })
          .filter(
            (
              item
            ): item is PortalHomeSnapshot["per_basic"][number] => item !== null
          )
      : [],
  }));
}

function flattenInspection(row: InvestigationRow) {
  return Array.isArray(row.inspections)
    ? row.inspections[0] ?? null
    : row.inspections;
}

function humanizeMonitoringActivity(description: string): string {
  const counts = description.match(
    /(\d+) new inspections; (\d+) new violations; (\d+) new crashes; (\d+) OOS changes/i
  );
  if (!counts) {
    return "We completed the latest FMCSA monitoring check.";
  }
  const [, inspectionText, violationText, crashText, oosText] = counts;
  const inspections = Number(inspectionText);
  const violations = Number(violationText);
  const crashes = Number(crashText);
  const oosChanges = Number(oosText);
  if (
    inspections === 0 &&
    violations === 0 &&
    crashes === 0 &&
    oosChanges === 0
  ) {
    return "We checked your FMCSA record. No new inspections, violations, crashes, or out-of-service changes were found.";
  }
  const findings = [
    inspections > 0
      ? `${inspections} new inspection${inspections === 1 ? "" : "s"}`
      : null,
    violations > 0
      ? `${violations} new violation${violations === 1 ? "" : "s"}`
      : null,
    crashes > 0 ? `${crashes} new crash${crashes === 1 ? "" : "es"}` : null,
    oosChanges > 0
      ? `${oosChanges} out-of-service change${oosChanges === 1 ? "" : "s"}`
      : null,
  ].filter((item): item is string => item !== null);
  return `Our latest FMCSA check found ${findings.join(", ")}.`;
}

function normalizeWorkNotes(rows: ActivityRow[]): PortalHomeWorkNote[] {
  const seenTypes = new Set<string>();
  const notes: PortalHomeWorkNote[] = [];
  for (const row of rows) {
    if (seenTypes.has(row.action_type)) continue;
    let text: string | null = null;
    if (row.action_type === "data_imported") {
      text = humanizeMonitoringActivity(row.description);
    } else if (row.action_type === "report_generated") {
      text = "GEIA prepared a new progress report for review.";
    } else if (row.action_type === "playbook_generated") {
      text = "GEIA refreshed your safety coaching playbook.";
    }
    if (!text) continue;
    seenTypes.add(row.action_type);
    notes.push({ id: row.id, text, createdAt: row.created_at });
    if (notes.length === 3) break;
  }
  return notes;
}

function normalizeAuthority(row: EnrichmentRow | null): PortalHomeAuthority | null {
  if (!row?.data || typeof row.data !== "object" || Array.isArray(row.data)) {
    return null;
  }
  const authorities = (row.data as Record<string, unknown>).authorities;
  if (!Array.isArray(authorities)) return null;
  const status = preferredAuthorityStatus(authorities);
  if (!status) return null;
  const active = status.toLowerCase() === "active";
  return {
    label: active ? "Authority active" : `Authority ${status.toLowerCase()}`,
    active,
    sourceLabel: "FMCSA Motus",
    fetchedAt: row.fetched_at,
  };
}

export async function loadPortalHomeSnapshots(
  input: {
    clientId: string;
    includeHistory: boolean;
  }
): Promise<PortalHomeSnapshot[]> {
  const service = await createServiceClient();
  const result = await service
    .from("burden_snapshots")
    .select(
      "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
    )
    .eq("client_id", input.clientId)
    .order("captured_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.includeHistory ? 8 : 1);
  queryError("Unable to load portal burden history", result.error);
  return normalizeSnapshots((result.data ?? []) as SnapshotQueryRow[]);
}

export async function loadPortalHomeHandling(input: {
  clientId: string;
  tier: ClientTier;
  snapshotPromise: Promise<PortalHomeSnapshot[]>;
}): Promise<{
  cases: PortalHomeCase[];
  workNotes: PortalHomeWorkNote[];
  investigateQueue: PortalHomeData["investigateQueue"];
}> {
  const service = await createServiceClient();
  const canSeeCases = tierHasFeature(input.tier, "case_visibility");
  const canSeeServiceActivity = tierHasFeature(
    input.tier,
    "monitoring_alerts"
  );
  const inspectionScopePromise: Promise<CanonicalInspectionScope> = canSeeCases
    ? getCanonicalInspectionScope(input.clientId, service)
    : Promise.resolve({ inspectionIds: [], source: "public" as const });

  const dataqPromise = canSeeCases
    ? service
        .from("dataq_cases")
        .select("id, case_number, status, filed_date, updated_at")
        .eq("client_id", input.clientId)
        .not("status", "in", '("approved","denied","closed")')
        .order("updated_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });

  const cpdpPromise = canSeeCases
    ? service
        .from("cpdp_cases")
        .select("id, case_number, status, filed_date, updated_at")
        .eq("client_id", input.clientId)
        .not("status", "in", '("determination_made","closed")')
        .order("updated_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });

  const activityPromise = canSeeServiceActivity
    ? service
        .from("activity_log")
        .select("id, action_type, description, created_at")
        .eq("client_id", input.clientId)
        .in("action_type", [
          "data_imported",
          "report_generated",
          "playbook_generated",
        ])
        .order("created_at", { ascending: false })
        .limit(18)
    : Promise.resolve({ data: [], error: null });

  const investigationPromise = inspectionScopePromise.then(async (scope) => {
    if (!canSeeCases) {
      return { data: [] as InvestigationRow[], error: null };
    }
    let query = service
      .from("violations")
      .select(
        "id, severity_weight, oos_violation, inspections!inner(inspection_date, mcmis_inspection_id)"
      )
      .eq("client_id", input.clientId)
      .eq("challenge_tier", "investigate");
    query =
      scope.source === "authenticated"
        ? query.not("inspections.mcmis_inspection_id", "is", null)
        : query.is("inspections.mcmis_inspection_id", null);
    return await query;
  });

  const [
    dataqResult,
    cpdpResult,
    activityResult,
    investigationResult,
    snapshots,
  ] = await Promise.all([
    dataqPromise,
    cpdpPromise,
    activityPromise,
    investigationPromise,
    input.snapshotPromise,
  ]);

  queryError("Unable to load portal DataQ cases", dataqResult.error);
  queryError("Unable to load portal CPDP cases", cpdpResult.error);
  queryError("Unable to load portal work notes", activityResult.error);
  queryError(
    "Unable to load portal investigation queue",
    investigationResult.error
  );

  const latestAsOf = snapshots[0]
    ? new Date(snapshots[0].captured_at)
    : new Date();
  const investigateRows =
    (investigationResult.data ?? []) as InvestigationRow[];
  const investigateQueue = investigateRows.reduce(
    (queue, row) => {
      const inspection = flattenInspection(row);
      const timeWeight = timeWeightFor(
        inspection?.inspection_date ?? null,
        latestAsOf
      );
      if (timeWeight === 0 || row.severity_weight == null) return queue;
      queue.violationCount += 1;
      queue.weightedPoints +=
        timeWeight *
        (row.severity_weight + (row.oos_violation === true ? 2 : 0));
      return queue;
    },
    { violationCount: 0, weightedPoints: 0 }
  );

  const cases: PortalHomeCase[] = [
    ...((dataqResult.data ?? []) as DataqCaseRow[]).map((row) => ({
      id: row.id,
      caseType: "DataQ" as const,
      caseNumber: row.case_number,
      status: row.status,
      filedDate: row.filed_date,
      updatedAt: row.updated_at,
    })),
    ...((cpdpResult.data ?? []) as CpdpCaseRow[]).map((row) => ({
      id: row.id,
      caseType: "CPDP" as const,
      caseNumber: row.case_number,
      status: row.status,
      filedDate: row.filed_date,
      updatedAt: row.updated_at,
    })),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);

  return {
    cases,
    workNotes: normalizeWorkNotes(
      (activityResult.data ?? []) as ActivityRow[]
    ),
    investigateQueue,
  };
}

export async function loadPortalHomeRequests(input: {
  clientId: string;
  tier: ClientTier;
}): Promise<PortalHomeRequest[]> {
  if (!tierHasFeature(input.tier, "evidence_requests")) return [];
  const service = await createServiceClient();
  const result = await service
    .from("client_requests")
    .select("id, title, description, due_at")
    .eq("client_id", input.clientId)
    .eq("responsibility", "client")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  queryError("Unable to load portal requests", result.error);
  return ((result.data ?? []) as RequestRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
  }));
}

export async function loadPortalHomeAuthority(
  clientId: string
): Promise<PortalHomeAuthority | null> {
  const service = await createServiceClient();
  const result = await service
    .from("carrier_profile_enrichments")
    .select("source, fetched_at, data")
    .eq("client_id", clientId)
    .eq("source", "fmcsa_motus")
    .limit(1)
    .maybeSingle();
  queryError("Unable to load portal authority status", result.error);
  return normalizeAuthority((result.data as EnrichmentRow | null) ?? null);
}

export async function loadPortalHomeData(input: {
  clientId: string;
  tier: ClientTier;
}): Promise<PortalHomeData> {
  const snapshotPromise = loadPortalHomeSnapshots({
    clientId: input.clientId,
    includeHistory: tierHasFeature(input.tier, "trend_history"),
  });
  const [snapshots, handling, requests, authority] = await Promise.all([
    snapshotPromise,
    loadPortalHomeHandling({ ...input, snapshotPromise }),
    loadPortalHomeRequests(input),
    loadPortalHomeAuthority(input.clientId),
  ]);
  return {
    snapshots,
    ...handling,
    requests,
    authority,
  };
}
