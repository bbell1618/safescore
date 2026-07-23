import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getCanonicalInspectionScope } from "../lib/fmcsa/canonical-inspection-scope";
import {
  buildReportGenerationData,
  buildReportPrompts,
  formatReportDate,
  generateValidatedReport,
  selectReportSnapshotPair,
  type ReportCaseRow,
  type ReportCoachingItemRow,
  type ReportComplianceInput,
  type ReportSnapshotRow,
  type ReportViolationRow,
} from "../lib/reports/report-generation";

loadEnvConfig(process.cwd());

const clientId =
  process.argv[2] ?? "879b62c2-f8ea-430d-b8d3-9264150d84bf";

type StoredCaseRow = {
  case_number: string | null;
  status: string;
  final_narrative: string | null;
  ai_narrative: string | null;
  filing_notes: string | null;
};

type NewViolationQueryRow = {
  id: string;
  inspection_id: string;
  violation_code: string;
  violation_description: string;
  severity_weight: number | null;
  oos_violation: boolean;
  created_at: string;
  inspections:
    | { inspection_date: string | null }
    | Array<{ inspection_date: string | null }>
    | null;
};

function storedCaseDescription(row: StoredCaseRow): string | null {
  for (const candidate of [
    row.final_narrative,
    row.filing_notes,
    row.ai_narrative,
  ]) {
    if (candidate?.trim()) return candidate;
  }
  return null;
}

function inspectionDate(row: NewViolationQueryRow): string | null {
  if (Array.isArray(row.inspections)) {
    return row.inspections[0]?.inspection_date ?? null;
  }
  return row.inspections?.inspection_date ?? null;
}

async function requestReportText(params: {
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL || "https://safescore.app",
      "X-Title": "Golden Era SafeScore",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat-v3-0324",
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: 0.2,
      max_tokens: 1800,
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with HTTP ${response.status}: ${rawBody.slice(0, 500)}`
    );
  }
  const payload = JSON.parse(rawBody) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  if (payload.choices?.[0]?.finish_reason === "length") {
    throw new Error("OpenRouter truncated the generated report.");
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("OpenRouter returned an empty report.");
  return content;
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const [
    clientResult,
    snapshotsResult,
    dataqResult,
    cpdpResult,
    coachingResult,
    driversResult,
    driverDocumentsResult,
    vehiclesResult,
    maintenanceResult,
    clearinghouseResult,
  ] = await Promise.all([
    service
      .from("clients")
      .select("id, name, dot_number, mc_number, tier")
      .eq("id", clientId)
      .single(),
    service
      .from("burden_snapshots")
      .select(
        "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
      )
      .eq("client_id", clientId)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(2),
    service
      .from("dataq_cases")
      .select(
        "case_number, status, final_narrative, ai_narrative, filing_notes, created_at"
      )
      .eq("client_id", clientId)
      .not("status", "in", '("approved","denied","closed")')
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    service
      .from("cpdp_cases")
      .select(
        "case_number, status, final_narrative, ai_narrative, filing_notes, created_at"
      )
      .eq("client_id", clientId)
      .not("status", "in", '("determination_made","closed")')
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    service
      .from("action_items")
      .select(
        "type, title, description, priority, projected_impact_score, status, due_date"
      )
      .eq("client_id", clientId)
      .neq("status", "dismissed")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true }),
    service
      .from("drivers")
      .select("cdl_number, cdl_expiry, medical_cert_expiry")
      .eq("client_id", clientId)
      .eq("status", "active"),
    service
      .from("driver_documents")
      .select("doc_type, expiry_date, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    service
      .from("vehicles")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active"),
    service
      .from("vehicle_maintenance")
      .select("maintenance_type, scheduled_date, completed_date, notes")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    service
      .from("clearinghouse_records")
      .select("query_date, result_type")
      .eq("client_id", clientId)
      .order("query_date", { ascending: true }),
  ]);

  for (const [label, result] of [
    ["client", clientResult],
    ["snapshots", snapshotsResult],
    ["DataQ cases", dataqResult],
    ["CPDP cases", cpdpResult],
    ["coaching", coachingResult],
    ["drivers", driversResult],
    ["driver documents", driverDocumentsResult],
    ["vehicles", vehiclesResult],
    ["maintenance", maintenanceResult],
    ["clearinghouse", clearinghouseResult],
  ] as const) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  const snapshotCandidates = (snapshotsResult.data ??
    []) as unknown as ReportSnapshotRow[];
  if (snapshotCandidates.length === 0) {
    throw new Error("No burden snapshot is available.");
  }
  if (
    snapshotCandidates.length > 1 &&
    snapshotCandidates[0]!.snapshot_date ===
      snapshotCandidates[1]!.snapshot_date
  ) {
    const priorDateResult = await service
      .from("burden_snapshots")
      .select(
        "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
      )
      .eq("client_id", clientId)
      .lt("snapshot_date", snapshotCandidates[0]!.snapshot_date)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (priorDateResult.error) throw priorDateResult.error;
    const priorDateSnapshot = (priorDateResult.data ??
      [])[0] as unknown as ReportSnapshotRow | undefined;
    if (priorDateSnapshot) snapshotCandidates.push(priorDateSnapshot);
  }
  const snapshotSelection = selectReportSnapshotPair(
    snapshotCandidates,
    true
  );
  const snapshots = snapshotSelection.snapshots;

  const canonicalScope = await getCanonicalInspectionScope(clientId, service);
  let newViolations: ReportViolationRow[] = [];
  if (snapshots[1]) {
    const violationsResult = await service
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, severity_weight, oos_violation, created_at, inspections(inspection_date)"
      )
      .eq("client_id", clientId)
      .gt("created_at", snapshots[1].captured_at)
      .lte("created_at", snapshots[0].captured_at)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (violationsResult.error) throw violationsResult.error;
    const canonicalIds = new Set(canonicalScope.inspectionIds);
    newViolations = (
      (violationsResult.data ?? []) as unknown as NewViolationQueryRow[]
    )
      .filter((row) => canonicalIds.has(row.inspection_id))
      .map((row) => ({
        id: row.id,
        violation_code: row.violation_code,
        violation_description: row.violation_description,
        severity_weight: row.severity_weight,
        oos_violation: row.oos_violation,
        inspection_date: inspectionDate(row),
      }));
  }

  const cases: ReportCaseRow[] = [
    ...((dataqResult.data ?? []) as unknown as StoredCaseRow[]).map((row) => ({
      case_type: "DataQ" as const,
      case_number: row.case_number,
      status: row.status,
      description: storedCaseDescription(row),
    })),
    ...((cpdpResult.data ?? []) as unknown as StoredCaseRow[]).map((row) => ({
      case_type: "CPDP" as const,
      case_number: row.case_number,
      status: row.status,
      description: storedCaseDescription(row),
    })),
  ];
  const compliance: ReportComplianceInput = {
    drivers: (driversResult.data ?? []) as ReportComplianceInput["drivers"],
    driverDocuments: (driverDocumentsResult.data ??
      []) as ReportComplianceInput["driverDocuments"],
    vehicles: (vehiclesResult.data ?? []) as ReportComplianceInput["vehicles"],
    maintenanceRecords: (maintenanceResult.data ??
      []) as ReportComplianceInput["maintenanceRecords"],
    clearinghouseRecords: (clearinghouseResult.data ??
      []) as ReportComplianceInput["clearinghouseRecords"],
  };
  const client = clientResult.data!;
  const reportData = buildReportGenerationData({
    reportType: "monthly",
    reportDate: formatReportDate(),
    serviceTier: client.tier,
    carrier: {
      name: client.name,
      dotNumber: client.dot_number,
      mcNumber: client.mc_number,
    },
    snapshots,
    newViolations,
    cases,
    coachingItems: (coachingResult.data ??
      []) as unknown as ReportCoachingItemRow[],
    compliance,
  });
  const prompts = buildReportPrompts(reportData);
  const attempts: Array<{
    attempt: number;
    systemPrompt: string;
    rawOutput?: string;
    error?: string;
  }> = [];

  let finalError: string | null = null;
  try {
    await generateValidatedReport(
      prompts,
      reportData,
      async ({ system, user, attempt }) => {
        const record = { attempt, systemPrompt: system } as (typeof attempts)[number];
        attempts.push(record);
        try {
          const rawOutput = await requestReportText({ system, user });
          record.rawOutput = rawOutput;
          return rawOutput;
        } catch (error) {
          record.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
    );
  } catch (error) {
    finalError = error instanceof Error ? error.message : String(error);
  }

  console.log(
    JSON.stringify(
      {
        selection: {
          queryOrder: ["captured_at DESC", "id DESC"],
          strategy: snapshotSelection.strategy,
          immediatePairIds: snapshotSelection.immediatePairIds,
          selectedSnapshotIds: snapshots.map((snapshot) => snapshot.id),
          canonicalInspectionSource: canonicalScope.source,
        },
        factPayload: reportData,
        attempts,
        finalError,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
