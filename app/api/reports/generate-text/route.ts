import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  REPORT_TYPE_CONFIGS,
  buildReportGenerationData,
  buildReportPrompts,
  formatReportDate,
  generateValidatedReport,
  reportTypeLabel,
  selectReportSnapshots,
  type ReportCaseRow,
  type ReportCrashRow,
  type ReportGenerationAttemptEvent,
  type ReportGenerationData,
  type ReportOpenRequestRow,
  type ReportPriorityViolationRow,
  type ReportSnapshotRow,
  type ReportType,
  type ReportViolationRow,
} from "@/lib/reports/report-generation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeClientTier } from "@/lib/tiers";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().uuid(),
  type: z.enum([
    "assessment",
    "monthly",
    "quarterly",
    "improvement",
    "underwriter",
  ]),
});

type ClientRow = {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
  tier: string | null;
  driver_count: number | null;
};
type CarrierProfileRow = {
  power_units: number | null;
  drivers: number | null;
  mcs150_mileage: number | null;
  mcs150_mileage_year: number | null;
  safer_as_of: string | null;
  fetched_at: string | null;
};
type StoredCaseRow = {
  id: string;
  case_number: string | null;
  status: string;
  filed_date: string | null;
  outcome: string | null;
  outcome_date?: string | null;
  determination_date?: string | null;
  final_narrative: string | null;
  ai_narrative: string | null;
  filing_notes: string | null;
  created_at: string;
};
type CurrentViolationQueryRow = {
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
  challenge_tier:
    | "strong"
    | "moderate"
    | "investigate"
    | "not_challengeable"
    | "operational"
    | null;
  created_at: string;
  inspections:
    | { inspection_date: string | null }
    | Array<{ inspection_date: string | null }>
    | null;
};
type StoredOpenRequestRow = {
  id: string;
  title: string;
  status: string;
  request_type: string | null;
  evidence_class: string | null;
  evidence_status: string | null;
  requested_items: unknown;
  created_at: string;
  violations:
    | { violation_code: string | null }
    | Array<{ violation_code: string | null }>
    | null;
};
type ReportRow = { id: string };
type ReportServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

const PAGE_SIZE = 1_000;
const ID_CHUNK_SIZE = 150;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
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
function inspectionDate(row: CurrentViolationQueryRow): string | null {
  return Array.isArray(row.inspections)
    ? row.inspections[0]?.inspection_date ?? null
    : row.inspections?.inspection_date ?? null;
}
function requestViolationCode(row: StoredOpenRequestRow): string | null {
  return Array.isArray(row.violations)
    ? row.violations[0]?.violation_code ?? null
    : row.violations?.violation_code ?? null;
}
function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function loadSnapshotRows(
  supabase: ReportServiceClient,
  clientId: string
): Promise<ReportSnapshotRow[]> {
  const countResult = await supabase
    .from("burden_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (countResult.error) {
    throw new Error(`Unable to count burden snapshots: ${countResult.error.message}`);
  }
  const expected = countResult.count ?? 0;
  const rows: ReportSnapshotRow[] = [];
  while (rows.length < expected) {
    const pageResult = await supabase
      .from("burden_snapshots")
      .select(
        "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
      )
      .eq("client_id", clientId)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (pageResult.error) {
      throw new Error(`Unable to load burden snapshots: ${pageResult.error.message}`);
    }
    const page = (pageResult.data ?? []) as unknown as ReportSnapshotRow[];
    if (page.length === 0) {
      throw new Error(
        `Unable to load burden snapshots: expected ${expected} rows but received ${rows.length}.`
      );
    }
    rows.push(...page);
  }
  return rows;
}

async function loadCurrentViolationRows(
  supabase: ReportServiceClient,
  clientId: string
): Promise<CurrentViolationQueryRow[]> {
  const countResult = await supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (countResult.error) {
    throw new Error(
      `Unable to count current violation priorities: ${countResult.error.message}`
    );
  }
  const expected = countResult.count ?? 0;
  const rows: CurrentViolationQueryRow[] = [];
  while (rows.length < expected) {
    const pageResult = await supabase
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, basic_category, severity_weight, oos_violation, convicted, citation_number, citation_result, challenge_reason, challenge_tier, created_at, inspections(inspection_date)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (pageResult.error) {
      throw new Error(
        `Unable to load current violation priorities: ${pageResult.error.message}`
      );
    }
    const page = (pageResult.data ?? []) as unknown as CurrentViolationQueryRow[];
    if (page.length === 0) {
      throw new Error(
        `Unable to load current violation priorities: expected ${expected} rows but received ${rows.length}.`
      );
    }
    rows.push(...page);
  }
  return rows;
}

async function loadCaseRows(
  supabase: ReportServiceClient,
  clientId: string,
  table: "dataq_cases" | "cpdp_cases"
): Promise<StoredCaseRow[]> {
  const isDataq = table === "dataq_cases";
  const selection = isDataq
    ? "id, case_number, status, filed_date, outcome, outcome_date, final_narrative, ai_narrative, filing_notes, created_at"
    : "id, case_number, status, filed_date, outcome, determination_date, final_narrative, ai_narrative, filing_notes, created_at";
  const rows: StoredCaseRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase
      .from(table)
      .select(selection)
      .eq("client_id", clientId)
      .neq("status", "draft")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error(`Unable to load ${isDataq ? "DataQ" : "CPDP"} cases: ${result.error.message}`);
    }
    const page = (result.data ?? []) as unknown as StoredCaseRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadCrashRows(
  supabase: ReportServiceClient,
  clientId: string
): Promise<ReportCrashRow[]> {
  const rows: ReportCrashRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase
      .from("crashes")
      .select("crash_date, state, report_number, tow_away")
      .eq("client_id", clientId)
      .order("crash_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error(`Unable to load crash record: ${result.error.message}`);
    }
    const page = (result.data ?? []) as unknown as ReportCrashRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadOpenRequestRows(
  supabase: ReportServiceClient,
  clientId: string
): Promise<ReportOpenRequestRow[]> {
  const rows: StoredOpenRequestRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase
      .from("client_requests")
      .select(
        "id, title, status, request_type, evidence_class, evidence_status, requested_items, created_at, violations!client_requests_violation_id_fkey(violation_code)"
      )
      .eq("client_id", clientId)
      .eq("responsibility", "client")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error(`Unable to load open client requests: ${result.error.message}`);
    }
    const page = (result.data ?? []) as unknown as StoredOpenRequestRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    request_type: row.request_type,
    evidence_class: row.evidence_class,
    evidence_status: row.evidence_status,
    violation_code: requestViolationCode(row),
    requested_items: row.requested_items,
  }));
}

function isFiledDataq(row: StoredCaseRow): boolean {
  return [
    "filed",
    "pending_state",
    "pending_fmcsa",
    "approved",
    "denied",
    "reconsidering",
    "closed",
  ].includes(row.status);
}
function isFiledCpdp(row: StoredCaseRow): boolean {
  return ["filed", "pending", "determination_made", "closed"].includes(
    row.status
  );
}
async function countClientEvidenceItems(
  supabase: ReportServiceClient,
  dataqRows: StoredCaseRow[],
  cpdpRows: StoredCaseRow[]
): Promise<number> {
  let total = 0;
  for (const ids of chunks(
    dataqRows.filter(isFiledDataq).map((row) => row.id),
    ID_CHUNK_SIZE
  )) {
    const result = await supabase
      .from("dataq_evidence")
      .select("id", { count: "exact", head: true })
      .in("case_id", ids)
      .in("status", ["received", "reviewed"])
      .or("uploaded_by.eq.client,acquisition_method.eq.client");
    if (result.error) {
      throw new Error(`Unable to count collected DataQ evidence: ${result.error.message}`);
    }
    total += result.count ?? 0;
  }
  for (const ids of chunks(
    cpdpRows.filter(isFiledCpdp).map((row) => row.id),
    ID_CHUNK_SIZE
  )) {
    const result = await supabase
      .from("cpdp_evidence")
      .select("id", { count: "exact", head: true })
      .in("case_id", ids)
      .eq("status", "received")
      .eq("uploaded_by", "client");
    if (result.error) {
      throw new Error(`Unable to count collected CPDP evidence: ${result.error.message}`);
    }
    total += result.count ?? 0;
  }
  return total;
}

function openRouterError(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // The bounded raw response still surfaces the provider failure.
  }
  return rawBody.trim().slice(0, 500) || "No provider error body returned";
}

async function requestReportText(params: {
  system: string;
  user: string;
  wordBudget: number;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Report generation is unavailable because OPENROUTER_API_KEY is not configured."
    );
  }
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
      max_tokens: Math.max(1_800, params.wordBudget * 3),
    }),
  });
  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with HTTP ${response.status}: ${openRouterError(rawBody)}`
    );
  }
  let data: {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string | null;
    }>;
  };
  try {
    data = JSON.parse(rawBody) as typeof data;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response.");
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("OpenRouter truncated the generated report before completion.");
  }
  const content = choice?.message?.content;
  if (!content?.trim()) throw new Error("OpenRouter returned an empty report.");
  return content;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceSupabase = await createServiceClient();
  const userResult = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (userResult.error) {
    return NextResponse.json(
      { error: `Unable to verify report permissions: ${userResult.error.message}` },
      { status: 500 }
    );
  }
  const role: string = userResult.data?.role ?? "client_user";
  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { clientId, type } = parsed.data as {
    clientId: string;
    type: ReportType;
  };
  const config = REPORT_TYPE_CONFIGS[type];

  const clientResult = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number, tier, driver_count")
    .eq("id", clientId)
    .single();
  if (clientResult.error || !clientResult.data) {
    const status = clientResult.error?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Client not found"
            : `Unable to load client: ${clientResult.error?.message ?? "Unknown database error"}`,
      },
      { status }
    );
  }
  const client = clientResult.data as ClientRow;
  const clientTier = normalizeClientTier(client.tier);

  let snapshotCandidates: ReportSnapshotRow[];
  let currentViolationRows: CurrentViolationQueryRow[];
  let dataqRows: StoredCaseRow[] = [];
  let cpdpRows: StoredCaseRow[] = [];
  let crashRows: ReportCrashRow[] = [];
  let openRequests: ReportOpenRequestRow[] = [];
  let carrierProfile: CarrierProfileRow | null = null;
  try {
    const shouldLoadViolations = config.includeOperationalPriorities;
    [snapshotCandidates, currentViolationRows] = await Promise.all([
      loadSnapshotRows(serviceSupabase, clientId),
      shouldLoadViolations
        ? loadCurrentViolationRows(serviceSupabase, clientId)
        : Promise.resolve([]),
    ]);
    const shouldLoadCases = type !== "assessment";
    const shouldLoadCrashes = type === "assessment";
    const shouldLoadFleet = type === "underwriter";
    const [dataq, cpdp, crashes, requestsResult, profileResult] = await Promise.all([
      shouldLoadCases
        ? loadCaseRows(serviceSupabase, clientId, "dataq_cases")
        : Promise.resolve([]),
      shouldLoadCases
        ? loadCaseRows(serviceSupabase, clientId, "cpdp_cases")
        : Promise.resolve([]),
      shouldLoadCrashes
        ? loadCrashRows(serviceSupabase, clientId)
        : Promise.resolve([]),
      config.includeOpenRequests
        ? loadOpenRequestRows(serviceSupabase, clientId)
        : Promise.resolve([]),
      shouldLoadFleet
        ? serviceSupabase
            .from("carrier_profiles")
            .select(
              "power_units, drivers, mcs150_mileage, mcs150_mileage_year, safer_as_of, fetched_at"
            )
            .eq("client_id", clientId)
            .order("fetched_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (profileResult.error) {
      throw new Error(`Unable to load carrier fleet facts: ${profileResult.error.message}`);
    }
    dataqRows = dataq;
    cpdpRows = cpdp;
    crashRows = crashes;
    openRequests = requestsResult;
    carrierProfile = profileResult.data as CarrierProfileRow | null;
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Unable to load report fact pack.") },
      { status: 500 }
    );
  }
  if (snapshotCandidates.length === 0) {
    return NextResponse.json(
      { error: "No burden snapshot is available for this client." },
      { status: 422 }
    );
  }

  let snapshotSelection;
  try {
    snapshotSelection = selectReportSnapshots(snapshotCandidates, type);
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Unable to select report snapshots.") },
      { status: 422 }
    );
  }
  const snapshots = snapshotSelection.snapshots;

  let canonicalInspectionIds = new Set<string>();
  if (config.includeOperationalPriorities) {
    try {
      const scope = await getCanonicalInspectionScope(clientId, serviceSupabase);
      canonicalInspectionIds = new Set(scope.inspectionIds);
    } catch (error) {
      return NextResponse.json(
        { error: errorMessage(error, "Unable to load canonical inspection scope.") },
        { status: 500 }
      );
    }
  }
  const canonicalViolationRows = currentViolationRows.filter((row) =>
    canonicalInspectionIds.has(row.inspection_id)
  );
  const priorityViolations: ReportPriorityViolationRow[] = canonicalViolationRows.map(
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
  const comparisonSnapshot = snapshots[1] ?? null;
  const latestSnapshot = snapshots[0]!;
  const newViolations: ReportViolationRow[] = comparisonSnapshot
    ? canonicalViolationRows
        .filter(
          (row) =>
            row.created_at > comparisonSnapshot.captured_at &&
            row.created_at <= latestSnapshot.captured_at
        )
        .map((row) => ({
          id: row.id,
          violation_code: row.violation_code,
          violation_description: row.violation_description,
          severity_weight: row.severity_weight,
          oos_violation: row.oos_violation,
          inspection_date: inspectionDate(row),
        }))
    : [];
  const agedOutViolationCount = comparisonSnapshot
    ? canonicalViolationRows.filter((row) => {
        if (row.created_at > comparisonSnapshot.captured_at) return false;
        const date = inspectionDate(row);
        return (
          timeWeightFor(date, new Date(comparisonSnapshot.captured_at)) > 0 &&
          timeWeightFor(date, new Date(latestSnapshot.captured_at)) === 0
        );
      }).length
    : 0;

  const cases: ReportCaseRow[] = [
    ...dataqRows.map((row) => ({
      case_type: "DataQ" as const,
      case_number: row.case_number,
      status: row.status,
      description: storedCaseDescription(row),
      filed_date: row.filed_date,
      outcome: row.outcome,
      outcome_date: row.outcome_date ?? null,
    })),
    ...cpdpRows.map((row) => ({
      case_type: "CPDP" as const,
      case_number: row.case_number,
      status: row.status,
      description: storedCaseDescription(row),
      filed_date: row.filed_date,
      outcome: row.outcome,
      outcome_date: row.determination_date ?? null,
    })),
  ];
  let clientEvidenceItemsCollected = 0;
  if (type === "improvement") {
    try {
      clientEvidenceItemsCollected = await countClientEvidenceItems(
        serviceSupabase,
        dataqRows,
        cpdpRows
      );
    } catch (error) {
      return NextResponse.json(
        { error: errorMessage(error, "Unable to count client evidence items.") },
        { status: 500 }
      );
    }
  }

  let reportData: ReportGenerationData;
  try {
    reportData = buildReportGenerationData({
      reportType: type,
      reportDate: formatReportDate(),
      serviceTier: clientTier,
      carrier: {
        name: client.name,
        dotNumber: client.dot_number,
        mcNumber: client.mc_number,
        fleet: {
          clientStatedDriverCount: client.driver_count,
          fmcsaPowerUnits: carrierProfile?.power_units ?? null,
          fmcsaDrivers: carrierProfile?.drivers ?? null,
          annualMileage: carrierProfile?.mcs150_mileage ?? null,
          annualMileageYear: carrierProfile?.mcs150_mileage_year ?? null,
          source: carrierProfile ? "FMCSA SAFER" : null,
          sourceAsOf:
            carrierProfile?.safer_as_of ?? carrierProfile?.fetched_at ?? null,
        },
      },
      snapshots,
      newViolations,
      agedOutViolationCount,
      onFileViolationCount: config.includeOperationalPriorities
        ? canonicalViolationRows.length
        : undefined,
      priorityViolations,
      priorityAsOf: new Date(latestSnapshot.captured_at),
      cases,
      crashes: crashRows,
      openRequests,
      clientEvidenceItemsCollected,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Unable to assemble report data.") },
      { status: 422 }
    );
  }

  const prompts = buildReportPrompts(reportData);
  const generationId = randomUUID();
  const attemptEvidence: ReportGenerationAttemptEvent[] = [];
  const recordAttempt = async (event: ReportGenerationAttemptEvent) => {
    attemptEvidence.push(event);
    const result = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "report_generation_attempt",
      entity_type: "report_generation",
      entity_id: generationId,
      description: `${reportTypeLabel(type)} generation attempt ${event.attempt} ${event.status}: ${event.reason}`,
      metadata: {
        generation_id: generationId,
        attempt: event.attempt,
        status: event.status,
        reason: event.reason,
        raw_output: event.rawOutput ?? null,
        validation_issues: event.validationIssues ?? [],
        report_type: type,
        audience: config.audience,
        latest_snapshot_id: reportData.latestSnapshot.id,
        comparison_snapshot_id: reportData.comparisonSnapshot?.id ?? null,
        comparison_mode: config.comparison.mode,
      },
    });
    if (result.error) {
      throw new Error(
        `Could not write report generation attempt ${event.attempt} ${event.status} to the activity log: ${result.error.message}`
      );
    }
  };

  let aiText: string;
  let generationAttempts: number;
  try {
    const generated = await generateValidatedReport(
      prompts,
      reportData,
      ({ system, user: userPrompt }) =>
        requestReportText({
          system,
          user: userPrompt,
          wordBudget: config.wordBudget,
        }),
      { onAttempt: recordAttempt }
    );
    aiText = generated.content;
    generationAttempts = generated.attempts;
  } catch (error) {
    const message = errorMessage(error, "Report generation failed.");
    console.error("Report generation failed:", message);
    const failureResult = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "report_generation_failed",
      entity_type: "report_generation",
      entity_id: generationId,
      description: `${reportTypeLabel(type)} generation failed: ${message}`,
      metadata: {
        generation_id: generationId,
        reason: message,
        report_type: type,
        fact_payload: reportData,
        attempt_outputs: attemptEvidence,
        snapshot_selection: snapshotSelection,
      },
    });
    if (failureResult.error) {
      return NextResponse.json(
        {
          error: `${message} Failure evidence could not be persisted: ${failureResult.error.message}`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const reportLabel = reportTypeLabel(type);
  const reportResult = await serviceSupabase
    .from("reports")
    .insert({
      client_id: clientId,
      type,
      title: `${reportLabel} - ${client.name}`,
      status: "draft",
      ai_content: aiText,
      final_content: aiText,
      created_by: user.id,
    })
    .select("id")
    .single();
  const report = reportResult.data as ReportRow | null;
  if (reportResult.error || !report) {
    const message = `Could not save report draft: ${reportResult.error?.message ?? "No report row returned"}`;
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const activityResult = await serviceSupabase.from("activity_log").insert({
    client_id: clientId,
    user_id: user.id,
    action_type: "report_generated",
    entity_type: "reports",
    entity_id: report.id,
    description: `${reportLabel} AI draft generated`,
    metadata: {
      generation_attempts: generationAttempts,
      report_type: type,
      audience: config.audience,
      service_tier: reportData.serviceTier,
      section_headings: reportData.sections.map((section) => section.heading),
      latest_snapshot_id: reportData.latestSnapshot.id,
      comparison_snapshot_id: reportData.comparisonSnapshot?.id ?? null,
      comparison_mode: config.comparison.mode,
      comparison_strategy: snapshotSelection.strategy,
      generation_id: generationId,
    },
  });
  if (activityResult.error) {
    return NextResponse.json(
      {
        error: `Report ${report.id} was saved, but its completion audit log failed: ${activityResult.error.message}`,
        reportId: report.id,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    reportId: report.id,
    content: aiText,
    generationAttempts,
  });
}
