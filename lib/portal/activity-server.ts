import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export type PortalActivitySnapshot = {
  id: string;
  snapshotDate: string;
  capturedAt: string;
  source: string;
  totalPoints: number;
};

export type PortalActivityAlert = {
  id: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

export type PortalActivityCase = {
  id: string;
  caseType: "dataq" | "cpdp";
  caseNumber: string | null;
  title: string;
  detail: string | null;
  status: string;
  filedDate: string | null;
  decisionDate: string | null;
  outcome: string | null;
  updatedAt: string;
};

type DataqQueryRow = {
  id: string;
  case_number: string | null;
  status: string;
  filed_date: string | null;
  outcome_date: string | null;
  outcome: string | null;
  updated_at: string;
  violations:
    | {
        violation_code: string | null;
        violation_description: string | null;
      }
    | Array<{
        violation_code: string | null;
        violation_description: string | null;
      }>
    | null;
};

type CpdpQueryRow = {
  id: string;
  case_number: string | null;
  status: string;
  filed_date: string | null;
  determination_date: string | null;
  outcome: string | null;
  updated_at: string;
  crashes:
    | {
        crash_date: string | null;
        state: string | null;
        city: string | null;
      }
    | Array<{
        crash_date: string | null;
        state: string | null;
        city: string | null;
      }>
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function cpdpTitle(row: CpdpQueryRow): { title: string; detail: string | null } {
  const crash = one(row.crashes);
  if (!crash) {
    return {
      title: "Crash preventability review",
      detail: null,
    };
  }
  const location = [crash.city, crash.state].filter(Boolean).join(", ");
  return {
    title: crash.crash_date
      ? `Crash on ${formatDateOnly(crash.crash_date)}`
      : "Crash preventability review",
    detail: location || null,
  };
}

function formatDateOnly(value: string): string {
  const parsed = new Date(
    value.includes("T") ? value : `${value}T00:00:00Z`
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function loadPortalActivitySnapshots(
  clientId: string
): Promise<PortalActivitySnapshot[]> {
  const service = await createServiceClient();
  const result = await service
    .from("burden_snapshots")
    .select("id, snapshot_date, captured_at, source, total_points")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: true })
    .order("captured_at", { ascending: true })
    .order("id", { ascending: true });

  if (result.error) {
    throw new Error(
      `Unable to load complete burden history: ${result.error.message}`
    );
  }

  return (result.data ?? []).map((row) => ({
    id: row.id,
    snapshotDate: row.snapshot_date,
    capturedAt: row.captured_at,
    source: row.source,
    totalPoints: row.total_points,
  }));
}

export async function loadPortalActivityAlerts(
  clientId: string
): Promise<PortalActivityAlert[]> {
  const service = await createServiceClient();
  const result = await service
    .from("alerts")
    .select("id, severity, title, message, created_at, read_at")
    .eq("client_id", clientId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

  if (result.error) {
    throw new Error(`Unable to load active alerts: ${result.error.message}`);
  }

  return (result.data ?? []).map((row) => ({
    id: row.id,
    severity: row.severity,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

/**
 * Call only after case_visibility has been evaluated for the linked portal
 * client's tier. Keeping this loader separate prevents a Monitor account from
 * issuing either case query.
 */
export async function loadPortalActivityCases(
  clientId: string
): Promise<PortalActivityCase[]> {
  const service = await createServiceClient();
  const [dataqResult, cpdpResult] = await Promise.all([
    service
      .from("dataq_cases")
      .select(
        "id, case_number, status, filed_date, outcome_date, outcome, updated_at, violations(violation_code, violation_description)"
      )
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    service
      .from("cpdp_cases")
      .select(
        "id, case_number, status, filed_date, determination_date, outcome, updated_at, crashes(crash_date, state, city)"
      )
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
  ]);

  if (dataqResult.error) {
    throw new Error(`Unable to load DataQ cases: ${dataqResult.error.message}`);
  }
  if (cpdpResult.error) {
    throw new Error(
      `Unable to load crash preventability cases: ${cpdpResult.error.message}`
    );
  }

  const dataqCases = ((dataqResult.data ?? []) as DataqQueryRow[]).map(
    (row): PortalActivityCase => {
      const violation = one(row.violations);
      return {
        id: row.id,
        caseType: "dataq",
        caseNumber: row.case_number,
        title: violation?.violation_description ?? "DataQ record review",
        detail: violation?.violation_code
          ? `Violation ${violation.violation_code}`
          : null,
        status: row.status,
        filedDate: row.filed_date,
        decisionDate: row.outcome_date,
        outcome: row.outcome,
        updatedAt: row.updated_at,
      };
    }
  );

  const cpdpCases = ((cpdpResult.data ?? []) as CpdpQueryRow[]).map(
    (row): PortalActivityCase => {
      const presentation = cpdpTitle(row);
      return {
        id: row.id,
        caseType: "cpdp",
        caseNumber: row.case_number,
        title: presentation.title,
        detail: presentation.detail,
        status: row.status,
        filedDate: row.filed_date,
        decisionDate: row.determination_date,
        outcome: row.outcome,
        updatedAt: row.updated_at,
      };
    }
  );

  return [...dataqCases, ...cpdpCases].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.caseType.localeCompare(right.caseType) ||
      left.id.localeCompare(right.id)
  );
}
