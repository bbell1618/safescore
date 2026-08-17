import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getCanonicalInspectionScope } from "../lib/fmcsa/canonical-inspection-scope";
import {
  buildReportGenerationData,
  buildReportPrompts,
  formatReportDate,
  generateValidatedReport,
  selectReportSnapshots,
  type ReportCaseRow,
  type ReportOpenRequestRow,
  type ReportPriorityViolationRow,
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
  filed_date: string | null;
  outcome: string | null;
  outcome_date?: string | null;
  determination_date?: string | null;
};

type NewViolationQueryRow = {
  id: string;
  inspection_id: string;
  violation_code: string;
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean;
  convicted: boolean | null;
  citation_number: string | null;
  citation_result: string | null;
  challenge_reason: string | null;
  challenge_tier: ReportPriorityViolationRow["challenge_tier"];
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
    violationsResult,
    openRequestsResult,
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
      .limit(1000),
    service
      .from("dataq_cases")
      .select(
        "case_number, status, final_narrative, ai_narrative, filing_notes, filed_date, outcome, outcome_date, created_at"
      )
      .eq("client_id", clientId)
      .neq("status", "draft")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    service
      .from("cpdp_cases")
      .select(
        "case_number, status, final_narrative, ai_narrative, filing_notes, filed_date, outcome, determination_date, created_at"
      )
      .eq("client_id", clientId)
      .neq("status", "draft")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    service
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, basic_category, severity_weight, oos_violation, convicted, citation_number, citation_result, challenge_reason, challenge_tier, created_at, inspections(inspection_date)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    service
      .from("client_requests")
      .select(
        "id, title, status, request_type, evidence_class, evidence_status, requested_items, violation_id, violations!client_requests_violation_id_fkey(violation_code)"
      )
      .eq("client_id", clientId)
      .eq("responsibility", "client")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  for (const [label, result] of [
    ["client", clientResult],
    ["snapshots", snapshotsResult],
    ["DataQ cases", dataqResult],
    ["CPDP cases", cpdpResult],
    ["violations", violationsResult],
    ["open requests", openRequestsResult],
  ] as const) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  const snapshotCandidates = (snapshotsResult.data ??
    []) as unknown as ReportSnapshotRow[];
  if (snapshotCandidates.length === 0) {
    throw new Error("No burden snapshot is available.");
  }
  const snapshotSelection = selectReportSnapshots(snapshotCandidates, "monthly");
  const snapshots = snapshotSelection.snapshots;

  const canonicalScope = await getCanonicalInspectionScope(clientId, service);
  const canonicalIds = new Set(canonicalScope.inspectionIds);
  const canonicalViolations = (
    (violationsResult.data ?? []) as unknown as NewViolationQueryRow[]
  ).filter((row) => canonicalIds.has(row.inspection_id));
  let newViolations: ReportViolationRow[] = [];
  if (snapshots[1]) {
    newViolations = canonicalViolations
      .filter(
        (row) =>
          row.created_at > snapshots[1]!.captured_at &&
          row.created_at <= snapshots[0]!.captured_at
      )
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
      filed_date: row.filed_date,
      outcome: row.outcome,
      outcome_date: row.outcome_date ?? null,
    })),
    ...((cpdpResult.data ?? []) as unknown as StoredCaseRow[]).map((row) => ({
      case_type: "CPDP" as const,
      case_number: row.case_number,
      status: row.status,
      description: storedCaseDescription(row),
      filed_date: row.filed_date,
      outcome: row.outcome,
      outcome_date: row.determination_date ?? null,
    })),
  ];
  const priorityViolations: ReportPriorityViolationRow[] = canonicalViolations.map(
    (row) => ({
      id: row.id,
      violation_code: row.violation_code,
      violation_description: row.violation_description,
      basic_category: row.basic_category,
      severity_weight: row.severity_weight,
      oos_violation: row.oos_violation,
      convicted: row.convicted,
      citation_number: row.citation_number,
      citation_result: row.citation_result,
      challenge_reason: row.challenge_reason,
      challenge_tier: row.challenge_tier,
      inspection_date: inspectionDate(row),
    })
  );
  const openRequests = (openRequestsResult.data ?? []).map((row) => {
    const violation = Array.isArray(row.violations)
      ? row.violations[0]
      : row.violations;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      request_type: row.request_type,
      evidence_class: row.evidence_class,
      evidence_status: row.evidence_status,
      violation_code: violation?.violation_code ?? null,
      requested_items: row.requested_items,
    } satisfies ReportOpenRequestRow;
  });
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
    onFileViolationCount: canonicalViolations.length,
    priorityViolations,
    priorityAsOf: new Date(snapshots[0]!.captured_at),
    cases,
    openRequests,
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
