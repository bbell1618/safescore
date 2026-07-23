import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  buildReportGenerationData,
  buildReportPrompts,
  formatReportDate,
  generateValidatedReport,
  reportTypeLabel,
  selectReportSnapshotPair,
  type ReportCaseRow,
  type ReportCoachingItemRow,
  type ReportComplianceInput,
  type ReportGenerationAttemptEvent,
  type ReportGenerationData,
  type ReportSnapshotRow,
  type ReportType,
  type ReportViolationRow,
} from "@/lib/reports/report-generation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["assessment", "monthly", "quarterly", "improvement", "underwriter"]),
});

type ClientRow = {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
  tier: string | null;
};

type ComplianceDriverRow = ReportComplianceInput["drivers"][number];
type ComplianceDriverDocumentRow = ReportComplianceInput["driverDocuments"][number];
type ComplianceVehicleRow = ReportComplianceInput["vehicles"][number];
type ComplianceMaintenanceRow = ReportComplianceInput["maintenanceRecords"][number];
type ComplianceClearinghouseRow = ReportComplianceInput["clearinghouseRecords"][number];

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

type ReportRow = {
  id: string;
};

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

function inspectionDate(row: NewViolationQueryRow): string | null {
  if (Array.isArray(row.inspections)) {
    return row.inspections[0]?.inspection_date ?? null;
  }
  return row.inspections?.inspection_date ?? null;
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
    // The status and a bounded raw response below still surface the provider failure.
  }
  return rawBody.trim().slice(0, 500) || "No provider error body returned";
}

async function requestReportText(params: {
  system: string;
  user: string;
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
      max_tokens: 1800,
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const clientResult = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number, tier")
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
  const canTrend = tierHasFeature(clientTier, "trend_history");
  const canSeeCases = tierHasFeature(clientTier, "case_visibility");
  const canSeeCoaching = tierHasFeature(clientTier, "playbook_coach");
  const canSeeCompliance = tierHasFeature(clientTier, "compliance_layer");
  const emptyResult = () => Promise.resolve({ data: [], error: null });

  const [
    snapshotCandidatesResult,
    dataqResult,
    cpdpResult,
    coachingResult,
    driversResult,
    driverDocumentsResult,
    vehiclesResult,
    maintenanceResult,
    clearinghouseResult,
  ] = await Promise.all([
    serviceSupabase
      .from("burden_snapshots")
      .select(
        "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
      )
      .eq("client_id", clientId)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(canTrend ? 2 : 1),
    canSeeCases
      ? serviceSupabase
          .from("dataq_cases")
          .select(
            "case_number, status, final_narrative, ai_narrative, filing_notes, created_at"
          )
          .eq("client_id", clientId)
          .not("status", "in", '("approved","denied","closed")')
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
      : emptyResult(),
    canSeeCases
      ? serviceSupabase
          .from("cpdp_cases")
          .select(
            "case_number, status, final_narrative, ai_narrative, filing_notes, created_at"
          )
          .eq("client_id", clientId)
          .not("status", "in", '("determination_made","closed")')
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
      : emptyResult(),
    canSeeCoaching
      ? serviceSupabase
          .from("action_items")
          .select(
            "type, title, description, priority, projected_impact_score, status, due_date"
          )
          .eq("client_id", clientId)
          .neq("status", "dismissed")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true })
      : emptyResult(),
    canSeeCompliance
      ? serviceSupabase
          .from("drivers")
          .select("cdl_number, cdl_expiry, medical_cert_expiry")
          .eq("client_id", clientId)
          .eq("status", "active")
      : emptyResult(),
    canSeeCompliance
      ? serviceSupabase
          .from("driver_documents")
          .select("doc_type, expiry_date, status")
          .eq("client_id", clientId)
          .order("created_at", { ascending: true })
      : emptyResult(),
    canSeeCompliance
      ? serviceSupabase
          .from("vehicles")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "active")
      : emptyResult(),
    canSeeCompliance
      ? serviceSupabase
          .from("vehicle_maintenance")
          .select("maintenance_type, scheduled_date, completed_date, notes")
          .eq("client_id", clientId)
          .order("created_at", { ascending: true })
      : emptyResult(),
    canSeeCompliance
      ? serviceSupabase
          .from("clearinghouse_records")
          .select("query_date, result_type")
          .eq("client_id", clientId)
          .order("query_date", { ascending: true })
      : emptyResult(),
  ]);

  for (const [label, result] of [
    ["burden snapshots", snapshotCandidatesResult],
    ["DataQ cases", dataqResult],
    ["CPDP cases", cpdpResult],
    ["coaching program", coachingResult],
    ["compliance drivers", driversResult],
    ["compliance driver documents", driverDocumentsResult],
    ["compliance vehicles", vehiclesResult],
    ["compliance maintenance", maintenanceResult],
    ["compliance clearinghouse records", clearinghouseResult],
  ] as const) {
    if (result.error) {
      return NextResponse.json(
        { error: `Unable to load ${label}: ${result.error.message}` },
        { status: 500 }
      );
    }
  }

  const snapshotCandidates = (snapshotCandidatesResult.data ??
    []) as unknown as ReportSnapshotRow[];
  if (snapshotCandidates.length === 0) {
    return NextResponse.json(
      { error: "No burden snapshot is available for this client." },
      { status: 422 }
    );
  }
  if (
    canTrend &&
    snapshotCandidates.length > 1 &&
    snapshotCandidates[0]!.snapshot_date ===
      snapshotCandidates[1]!.snapshot_date
  ) {
    const priorDateResult = await serviceSupabase
      .from("burden_snapshots")
      .select(
        "id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count"
      )
      .eq("client_id", clientId)
      .lt("snapshot_date", snapshotCandidates[0]!.snapshot_date)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (priorDateResult.error) {
      return NextResponse.json(
        {
          error: `Unable to load the prior reporting date: ${priorDateResult.error.message}`,
        },
        { status: 500 }
      );
    }
    const priorDateSnapshot = (priorDateResult.data ??
      [])[0] as unknown as ReportSnapshotRow | undefined;
    if (priorDateSnapshot) snapshotCandidates.push(priorDateSnapshot);
  }

  let snapshotSelection;
  try {
    snapshotSelection = selectReportSnapshotPair(snapshotCandidates, canTrend);
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Unable to select report snapshots.") },
      { status: 422 }
    );
  }
  const snapshots = snapshotSelection.snapshots;

  let newViolations: ReportViolationRow[] = [];
  if (canTrend && snapshots[1]) {
    let canonicalInspectionIds: Set<string>;
    try {
      const scope = await getCanonicalInspectionScope(clientId, serviceSupabase);
      canonicalInspectionIds = new Set(scope.inspectionIds);
    } catch (error) {
      return NextResponse.json(
        { error: errorMessage(error, "Unable to load canonical inspection scope.") },
        { status: 500 }
      );
    }

    const violationsResult = await serviceSupabase
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, severity_weight, oos_violation, created_at, inspections(inspection_date)"
      )
      .eq("client_id", clientId)
      .gt("created_at", snapshots[1].captured_at)
      .lte("created_at", snapshots[0].captured_at)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (violationsResult.error) {
      return NextResponse.json(
        {
          error: `Unable to load newly present violations: ${violationsResult.error.message}`,
        },
        { status: 500 }
      );
    }

    newViolations = ((violationsResult.data ?? []) as unknown as NewViolationQueryRow[])
      .filter((row) => canonicalInspectionIds.has(row.inspection_id))
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
  const coachingItems = (coachingResult.data ?? []) as unknown as ReportCoachingItemRow[];
  const compliance: ReportComplianceInput = {
    drivers: (driversResult.data ?? []) as unknown as ComplianceDriverRow[],
    driverDocuments: (driverDocumentsResult.data ?? []) as unknown as ComplianceDriverDocumentRow[],
    vehicles: (vehiclesResult.data ?? []) as unknown as ComplianceVehicleRow[],
    maintenanceRecords: (maintenanceResult.data ?? []) as unknown as ComplianceMaintenanceRow[],
    clearinghouseRecords: (clearinghouseResult.data ?? []) as unknown as ComplianceClearinghouseRow[],
  };

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
      },
      snapshots,
      newViolations,
      cases,
      coachingItems,
      compliance,
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
        latest_snapshot_id: reportData.latestSnapshot.id,
        previous_snapshot_id: reportData.previousSnapshot?.id ?? null,
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
        requestReportText({ system, user: userPrompt }),
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
        fact_payload: reportData,
        attempt_outputs: attemptEvidence,
        snapshot_selection: {
          strategy: snapshotSelection.strategy,
          immediate_pair_ids: snapshotSelection.immediatePairIds,
          selected_snapshot_ids: snapshots.map((snapshot) => snapshot.id),
        },
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
      service_tier: reportData.serviceTier,
      section_headings: reportData.sections.map((section) => section.heading),
      latest_snapshot_id: reportData.latestSnapshot.id,
      previous_snapshot_id: reportData.previousSnapshot?.id ?? null,
      generation_id: generationId,
      snapshot_selection_strategy: snapshotSelection.strategy,
      immediate_snapshot_pair_ids: snapshotSelection.immediatePairIds,
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
