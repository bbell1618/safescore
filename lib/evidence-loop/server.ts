import type { SupabaseClient } from "@supabase/supabase-js";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { computeViolationWeightedPoints } from "@/lib/analysis/score-impact";
import {
  buildLaneBEvidenceRequestCopy,
  CITATION_DISMISSED_INTAKE_QUESTION,
  evidenceClassesForViolation,
  LANE_B_EVIDENCE_TAXONOMY,
  type LaneBEvidenceClass,
  type LaneBEvidenceItem,
} from "@/lib/evidence-loop/taxonomy";
import { tierHasFeature } from "@/lib/tiers";
import { laneBEvidenceOutcome } from "@/lib/evidence-loop/lifecycle";
import { bridgeLaneBRequestToDataqCase } from "@/lib/evidence-loop/dataq-bridge";

type SupabaseLike = SupabaseClient;

type InspectionRelation =
  | { inspection_date: string | null }
  | Array<{ inspection_date: string | null }>
  | null;

type ViolationRow = {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  challenge_tier: string | null;
  challenge_reason: string | null;
  citation_number: string | null;
  citation_result: string | null;
  inspections: InspectionRelation;
};

type DataqCaseRow = {
  id: string;
  violation_id: string | null;
  status: string | null;
};

type RequestRow = {
  id: string;
  dedupe_key: string;
  case_id: string | null;
  status: string;
  evidence_status: string | null;
};

export type LaneBReconcileTrigger =
  | "challengeability"
  | "monitoring_cron"
  | "case_open"
  | "first_use"
  | "intake_answer"
  | "onboarding";

export type LaneBReconcileResult = {
  reviewedViolations: number;
  createdRequestIds: string[];
  existingRequestIds: string[];
  errors: string[];
};

export type LaneBLoopReconcileResult = LaneBReconcileResult & {
  intakeQuestionId: string | null;
  intakeQuestionCreated: boolean;
  citationFollowupId: string | null;
};

const CLOSED_DATAQ_CASE_STATUSES = new Set(["approved", "denied", "closed"]);

function one<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

export function laneBEvidenceDedupeKey(
  clientId: string,
  violationId: string,
  evidenceClass: LaneBEvidenceClass
) {
  return `${clientId}:lane-b:${violationId}:${evidenceClass}`;
}

function nextReminderAt(now: Date) {
  return new Date(now.getTime() + 7 * 86_400_000).toISOString();
}

function requestItemsForGenericCitation(): LaneBEvidenceItem[] {
  const definition = LANE_B_EVIDENCE_TAXONOMY["citation-dismissed"];
  return definition.items.map((item) => ({
    ...item,
    contextNote: definition.ask,
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inspectionDateFor(row: ViolationRow) {
  return one(row.inspections)?.inspection_date ?? null;
}

async function clientHasEvidenceRequestsFeature(
  service: SupabaseLike,
  clientId: string
) {
  const { data, error } = await service
    .from("clients")
    .select("tier")
    .eq("id", clientId)
    .single();
  if (error || !data) {
    throw new Error(
      `Unable to verify evidence-request tier: ${error?.message ?? "client not found"}`
    );
  }
  return tierHasFeature(data.tier, "evidence_requests");
}

export function potentialPointsForViolation(row: ViolationRow, asOf = new Date()) {
  if (row.severity_weight === null) return 0;
  return computeViolationWeightedPoints({
    id: row.id,
    basicCategory: "lane_b",
    severityWeight: row.severity_weight,
    timeWeight: timeWeightFor(inspectionDateFor(row), asOf),
    oosViolation: Boolean(row.oos_violation),
  });
}

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 150;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadLaneBViolations(
  service: SupabaseLike,
  clientId: string,
  explicitIds: string[]
): Promise<ViolationRow[]> {
  const idChunks: Array<string[] | null> =
    explicitIds.length > 0 ? chunks(explicitIds, ID_CHUNK_SIZE) : [null];
  const rows: ViolationRow[] = [];

  for (const idChunk of idChunks) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = service
        .from("violations")
        .select(
          "id, violation_code, violation_description, severity_weight, oos_violation, challenge_tier, challenge_reason, citation_number, citation_result, inspections(inspection_date)"
        )
        .eq("client_id", clientId)
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (idChunk === null) {
        query = query.in("challenge_tier", ["strong", "moderate", "investigate"]);
      }
      if (idChunk) query = query.in("id", idChunk);
      const { data, error } = await query;
      if (error) {
        throw new Error(`Unable to load Lane B violations: ${error.message}`);
      }
      const page = (data ?? []) as unknown as ViolationRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }

  return rows;
}

async function loadClientDataqCases(
  service: SupabaseLike,
  clientId: string
): Promise<DataqCaseRow[]> {
  const rows: DataqCaseRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("dataq_cases")
      .select("id, violation_id, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Unable to load Lane B cases: ${error.message}`);
    const page = (data ?? []) as DataqCaseRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function notificationContext(service: SupabaseLike, clientId: string) {
  const [clientResult, recipientResult] = await Promise.all([
    service.from("clients").select("name").eq("id", clientId).single(),
    service
      .from("users")
      .select("email")
      .eq("client_id", clientId)
      .eq("role", "client_user")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (clientResult.error) {
    throw new Error(`Unable to load request notification client: ${clientResult.error.message}`);
  }
  if (recipientResult.error) {
    throw new Error(`Unable to load request notification recipient: ${recipientResult.error.message}`);
  }
  return {
    companyName: clientResult.data?.name ?? "Your company",
    email: recipientResult.data?.email ?? null,
  };
}

type EmailDelivery = {
  status: "dry_run" | "skipped" | "failed";
  dry_run: boolean;
  reason?: string;
};

async function notifyNewRequest(
  service: SupabaseLike,
  input: {
    clientId: string;
    requestId: string;
    requestType: "evidence" | "question";
    title: string;
    whyCopy: string;
    evidenceClass: LaneBEvidenceClass;
    violationId: string | null;
    caseId: string | null;
    potentialPoints: number | null;
    itemKeys: string[];
    trigger: LaneBReconcileTrigger;
  }
) {
  let delivery: EmailDelivery;
  const explicitDryRun =
    process.env.EMAIL_DRY_RUN?.trim().toLowerCase() === "true";

  if (!explicitDryRun) {
    delivery = {
      status: "skipped",
      dry_run: false,
      reason: "email_live_send_not_authorized",
    };
  } else {
    const context = await notificationContext(service, input.clientId);
    if (!context.email) {
      delivery = {
        status: "skipped",
        dry_run: true,
        reason: "no_client_email",
      };
    } else {
      const emailClient = await import("@/lib/email/client");
      const portalUrl = `${
        process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
      }/portal/documents#needed-from-you`;
      const emailResult =
        input.requestType === "question"
          ? await emailClient.sendEvidenceIntakeQuestion({
              to: context.email,
              companyName: context.companyName,
              question: input.title,
              portalUrl,
            })
          : await emailClient.sendEvidenceRequestCreated({
              to: context.email,
              companyName: context.companyName,
              requestTitle: input.title,
              whyCopy: input.whyCopy,
              portalUrl,
            });
      delivery = emailResult.success
        ? { status: "dry_run", dry_run: true }
        : {
            status: "failed",
            dry_run: true,
            reason: emailResult.error ?? "request_notification_failed",
          };
    }
  }

  const { error: activityError } = await service.from("activity_log").insert({
    client_id: input.clientId,
    action_type:
      input.requestType === "question"
        ? "lane_b_intake_question_created"
        : "lane_b_evidence_requested",
    entity_type: "client_requests",
    entity_id: input.requestId,
    description:
      input.requestType === "question"
        ? `Client question ready: ${input.title}`
        : `Evidence request created: ${input.title}`,
    metadata: {
      evidence_class: input.evidenceClass,
      request_type: input.requestType,
      violation_id: input.violationId,
      case_id: input.caseId,
      potential_points: input.potentialPoints,
      requested_item_keys: input.itemKeys,
      trigger: input.trigger,
      email_delivery: delivery,
    },
  });
  if (activityError) {
    throw new Error(
      `Evidence request ${input.requestId} was created, but activity logging failed: ${activityError.message}`
    );
  }
  if (delivery.status === "failed") {
    throw new Error(
      `Evidence request ${input.requestId} was created, but its dry-run notification failed: ${delivery.reason}`
    );
  }
}

async function insertRequestIfMissing(
  service: SupabaseLike,
  input: {
    payload: Record<string, unknown>;
    dedupeKey: string;
    clientId: string;
    requestType: "evidence" | "question";
    evidenceClass: LaneBEvidenceClass;
    violationId: string | null;
    caseId: string | null;
    potentialPoints: number | null;
    itemKeys: string[];
    trigger: LaneBReconcileTrigger;
    title: string;
    whyCopy: string;
  }
): Promise<{ row: RequestRow; created: boolean }> {
  const { data: inserted, error: insertError } = await service
    .from("client_requests")
    .insert(input.payload)
    .select("id, dedupe_key, case_id, status, evidence_status")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Unable to create Lane B request: ${insertError.message}`);
  }

  if (inserted) {
    await notifyNewRequest(service, {
      clientId: input.clientId,
      requestId: inserted.id,
      requestType: input.requestType,
      title: input.title,
      whyCopy: input.whyCopy,
      evidenceClass: input.evidenceClass,
      violationId: input.violationId,
      caseId: input.caseId,
      potentialPoints: input.potentialPoints,
      itemKeys: input.itemKeys,
      trigger: input.trigger,
    });
    return { row: inserted as RequestRow, created: true };
  }

  const { data: existing, error: existingError } = await service
    .from("client_requests")
    .select("id, dedupe_key, case_id, status, evidence_status")
    .eq("dedupe_key", input.dedupeKey)
    .single();
  if (existingError || !existing) {
    throw new Error(
      `Lane B request conflict could not be resolved: ${
        existingError?.message ?? "row not found"
      }`
    );
  }
  const { data: activity, error: activityError } = await service
    .from("activity_log")
    .select("id, metadata")
    .eq(
      "action_type",
      input.requestType === "question"
        ? "lane_b_intake_question_created"
        : "lane_b_evidence_requested"
    )
    .eq("entity_type", "client_requests")
    .eq("entity_id", existing.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activityError) {
    throw new Error(
      `Unable to verify Lane B request activity ${existing.id}: ${activityError.message}`
    );
  }
  const priorDelivery = activity?.metadata as
    | { email_delivery?: { status?: string } }
    | null;
  const canRetryDryRunNotification =
    process.env.EMAIL_DRY_RUN?.trim().toLowerCase() === "true" &&
    priorDelivery?.email_delivery?.status !== "dry_run";
  if (!activity || canRetryDryRunNotification) {
    await notifyNewRequest(service, {
      clientId: input.clientId,
      requestId: existing.id,
      requestType: input.requestType,
      title: input.title,
      whyCopy: input.whyCopy,
      evidenceClass: input.evidenceClass,
      violationId: input.violationId,
      caseId: input.caseId,
      potentialPoints: input.potentialPoints,
      itemKeys: input.itemKeys,
      trigger: input.trigger,
    });
  }
  return { row: existing as RequestRow, created: false };
}

export async function reconcileLaneBEvidenceRequests(
  service: SupabaseLike,
  input: {
    clientId: string;
    violationIds?: string[];
    trigger: LaneBReconcileTrigger;
    now?: Date;
  }
): Promise<LaneBReconcileResult> {
  if (!(await clientHasEvidenceRequestsFeature(service, input.clientId))) {
    return {
      reviewedViolations: 0,
      createdRequestIds: [],
      existingRequestIds: [],
      errors: [],
    };
  }
  const explicitIds = [...new Set((input.violationIds ?? []).filter(Boolean))];
  const now = input.now ?? new Date();
  const [baseViolations, dataqCases] = await Promise.all([
    loadLaneBViolations(service, input.clientId, explicitIds),
    loadClientDataqCases(service, input.clientId),
  ]);
  const casesByViolation = new Map<string, DataqCaseRow>();
  for (const row of dataqCases) {
    if (
      row.violation_id &&
      !casesByViolation.has(row.violation_id) &&
      !CLOSED_DATAQ_CASE_STATUSES.has(row.status ?? "")
    ) {
      casesByViolation.set(row.violation_id, row);
    }
  }

  // A case can remain open even after its violation no longer has an actionable
  // challenge tier. Include those case-linked rows during a full reconciliation
  // so a transient failure in the synchronous case-open hook is self-healed by
  // the next scheduled run. Explicit single-violation calls stay narrowly scoped.
  const caseViolations =
    explicitIds.length === 0 && casesByViolation.size > 0
      ? await loadLaneBViolations(
          service,
          input.clientId,
          [...casesByViolation.keys()]
        )
      : [];
  const violations = [
    ...new Map(
      [...baseViolations, ...caseViolations].map((violation) => [
        violation.id,
        violation,
      ])
    ).values(),
  ];

  const plans = violations.flatMap((violation) => {
    const potentialPoints = potentialPointsForViolation(violation, now);
    if (potentialPoints <= 0) return [];
    const linkedCase = casesByViolation.get(violation.id) ?? null;
    const classes = evidenceClassesForViolation(
      {
        challengeTier: violation.challenge_tier,
        challengeReason: violation.challenge_reason,
        violationCode: violation.violation_code,
        violationDescription: violation.violation_description,
        citationNumber: violation.citation_number,
        citationResult: violation.citation_result,
      },
      { caseOpen: Boolean(linkedCase) || input.trigger === "case_open" }
    );
    return classes.map((evidenceClass) => {
      const copy = buildLaneBEvidenceRequestCopy(evidenceClass, potentialPoints, {
        violationCode: violation.violation_code,
        violationDescription: violation.violation_description,
        inspectionDate: inspectionDateFor(violation),
      });
      return {
        violation,
        evidenceClass,
        potentialPoints,
        linkedCase,
        copy,
        dedupeKey: laneBEvidenceDedupeKey(
          input.clientId,
          violation.id,
          evidenceClass
        ),
      };
    });
  });

  const createdRequestIds: string[] = [];
  const existingRequestIds: string[] = [];
  const errors: string[] = [];

  for (const plan of plans) {
    try {
      const result = await insertRequestIfMissing(service, {
        clientId: input.clientId,
        requestType: "evidence",
        dedupeKey: plan.dedupeKey,
        evidenceClass: plan.evidenceClass,
        violationId: plan.violation.id,
        caseId: plan.linkedCase?.id ?? null,
        potentialPoints: plan.potentialPoints,
        itemKeys: plan.copy.requestedItems.map((item) => item.itemKey),
        trigger: input.trigger,
        title: plan.copy.title,
        whyCopy: plan.copy.whyCopy,
        payload: {
          client_id: input.clientId,
          dedupe_key: plan.dedupeKey,
          category: "lane_b_evidence",
          title: plan.copy.title,
          description: plan.copy.statusCopy,
          why_copy: plan.copy.whyCopy,
          source: plan.linkedCase ? "case" : "standing",
          responsibility: "client",
          request_type: "evidence",
          evidence_class: plan.evidenceClass,
          evidence_status: "open",
          violation_id: plan.violation.id,
          case_type: plan.linkedCase ? "dataq" : null,
          case_id: plan.linkedCase?.id ?? null,
          potential_points: plan.potentialPoints,
          requested_items: plan.copy.requestedItems,
          status: "open",
          status_copy: plan.copy.statusCopy,
          next_reminder_at: nextReminderAt(now),
          closed_at: null,
          updated_at: now.toISOString(),
        },
      });

      if (result.created) createdRequestIds.push(result.row.id);
      else {
        existingRequestIds.push(result.row.id);
        if (plan.linkedCase && !result.row.case_id) {
          const { data: linkedRequest, error: linkError } = await service
            .from("client_requests")
            .update({
              source: "case",
              case_type: "dataq",
              case_id: plan.linkedCase.id,
              updated_at: now.toISOString(),
            })
            .eq("id", result.row.id)
            .is("case_id", null)
            .select("id")
            .maybeSingle();
          if (linkError || !linkedRequest) {
            throw new Error(
              `Unable to attach Lane B request ${result.row.id} to case ${plan.linkedCase.id}: ${
                linkError?.message ?? "row not updated"
              }`
            );
          }
        }
        if (plan.linkedCase) {
          await bridgeLaneBRequestToDataqCase(service, {
            clientId: input.clientId,
            requestId: result.row.id,
            violationId: plan.violation.id,
            caseId: plan.linkedCase.id,
          });
        }
      }
    } catch (error) {
      errors.push(`${plan.dedupeKey}: ${errorMessage(error)}`);
    }
  }

  return {
    reviewedViolations: violations.length,
    createdRequestIds,
    existingRequestIds,
    errors,
  };
}

export async function advanceSubmittedLaneBRequests(
  service: SupabaseLike,
  input: {
    clientId: string;
    requestId: string;
    outcomes: Array<{
      violationId: string;
      beforeTier: string | null;
      afterTier: string | null;
      analysisDecision: "supported" | "insufficient" | "failed";
    }>;
    trigger: "evidence_upload";
    now?: Date;
  }
) {
  const now = (input.now ?? new Date()).toISOString();
  const advancedRequestIds: string[] = [];
  const errors: string[] = [];

  for (const outcome of input.outcomes) {
    const decision = laneBEvidenceOutcome(
      outcome.beforeTier,
      outcome.afterTier,
      outcome.analysisDecision
    );
    if (!decision.evidenceStatus || !decision.statusCopy) continue;

    const { data: requests, error: requestError } = await service
      .from("client_requests")
      .select("id, evidence_status")
      .eq("client_id", input.clientId)
      .eq("id", input.requestId)
      .eq("request_type", "evidence")
      .eq("violation_id", outcome.violationId)
      .eq("status", "open")
      .eq("evidence_status", "submitted");
    if (requestError) {
      errors.push(
        `${outcome.violationId}: unable to load submitted requests: ${requestError.message}`
      );
      continue;
    }

    for (const request of requests ?? []) {
      const { evidenceStatus, strengthened, statusCopy } = decision;
      const applied = evidenceStatus === "applied";
      const { data: updated, error: updateError } = await service
        .from("client_requests")
        .update({
          status: applied ? "fulfilled" : "open",
          evidence_status: evidenceStatus,
          status_copy: statusCopy,
          applied_at: applied ? now : null,
          closed_at: applied ? now : null,
          updated_at: now,
        })
        .eq("id", request.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (updateError || !updated) {
        errors.push(
          `${request.id}: ${updateError?.message ?? "request was not advanced"}`
        );
        continue;
      }

      const { error: activityError } = await service.from("activity_log").insert({
        client_id: input.clientId,
        action_type: "lane_b_evidence_status_changed",
        entity_type: "client_requests",
        entity_id: request.id,
        description: statusCopy,
        metadata: {
          violation_id: outcome.violationId,
          before_tier: outcome.beforeTier,
          after_tier: outcome.afterTier,
          strengthened,
          evidence_status: evidenceStatus,
          trigger: input.trigger,
        },
      });
      if (activityError) {
        const { data: rolledBack, error: rollbackError } = await service
          .from("client_requests")
          .update({
            status: "open",
            evidence_status: "submitted",
            status_copy:
              "Evidence received — we could not record the outcome. Please contact GEIA.",
            applied_at: null,
            closed_at: null,
            updated_at: now,
          })
          .eq("id", request.id)
          .select("id")
          .maybeSingle();
        errors.push(
          `${request.id}: status advanced, but activity logging failed: ${activityError.message}${
            rollbackError || !rolledBack
              ? `; rollback also failed: ${rollbackError?.message ?? "row not updated"}`
              : ""
          }`
        );
        continue;
      }
      advancedRequestIds.push(request.id);
    }
  }

  return { advancedRequestIds, errors };
}

export async function ensureCitationDismissedIntakeQuestion(
  service: SupabaseLike,
  input: {
    clientId: string;
    trigger: LaneBReconcileTrigger;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const { data: client, error: clientError } = await service
    .from("clients")
    .select("citation_dismissed_last_24_months, tier")
    .eq("id", input.clientId)
    .single();
  if (clientError || !client) {
    throw new Error(
      `Unable to load Lane B intake state: ${clientError?.message ?? "client not found"}`
    );
  }
  if (!tierHasFeature(client.tier, "evidence_requests")) {
    return { requestId: null, created: false, skipped: "not_in_tier" as const };
  }
  if (typeof client.citation_dismissed_last_24_months === "boolean") {
    return { requestId: null, created: false, skipped: "already_answered" as const };
  }

  const dedupeKey = `${input.clientId}:lane-b:intake:citation-dismissed-question`;
  const result = await insertRequestIfMissing(service, {
    clientId: input.clientId,
    requestType: "question",
    dedupeKey,
    evidenceClass: "citation-dismissed",
    violationId: null,
    caseId: null,
    potentialPoints: null,
    itemKeys: [],
    trigger: input.trigger,
    title: CITATION_DISMISSED_INTAKE_QUESTION,
    whyCopy:
      "A favorable court result can support removing the related roadside violation from the carrier's record.",
    payload: {
      client_id: input.clientId,
      dedupe_key: dedupeKey,
      category: "lane_b_intake",
      title: CITATION_DISMISSED_INTAKE_QUESTION,
      description:
        "Your answer tells SafeScore whether to ask for a certified court disposition.",
      why_copy:
        "A favorable court result can support removing the related roadside violation from the carrier's record.",
      source: "standing",
      responsibility: "client",
      request_type: "question",
      evidence_class: "citation-dismissed",
      evidence_status: "open",
      requested_items: [],
      status: "open",
      status_copy: "Choose yes or no. A yes answer opens the court-document request automatically.",
      next_reminder_at: nextReminderAt(now),
      updated_at: now.toISOString(),
    },
  });
  return { requestId: result.row.id, created: result.created, skipped: null };
}

export async function ensureCitationDispositionFollowup(
  service: SupabaseLike,
  input: {
    clientId: string;
    trigger: LaneBReconcileTrigger;
    now?: Date;
    sourceRequestId?: string;
  }
) {
  if (!(await clientHasEvidenceRequestsFeature(service, input.clientId))) {
    return { requestId: null, generic: false, skipped: "not_in_tier" as const };
  }
  const reconciled = await reconcileLaneBEvidenceRequests(service, {
    clientId: input.clientId,
    trigger: input.trigger,
    now: input.now,
  });
  if (reconciled.errors.length > 0) {
    throw new Error(`Citation follow-up reconciliation failed: ${reconciled.errors.join(" | ")}`);
  }
  const { data: directRequest, error: directRequestError } = await service
    .from("client_requests")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("request_type", "evidence")
    .eq("evidence_class", "citation-dismissed")
    .eq("status", "open")
    .in("evidence_status", ["open", "submitted", "insufficient"])
    .not("violation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (directRequestError) {
    throw new Error(
      `Unable to resolve citation disposition request: ${directRequestError.message}`
    );
  }
  if (directRequest?.id) return { requestId: directRequest.id, generic: false };

  const now = input.now ?? new Date();
  const dedupeKey = input.sourceRequestId
    ? `${input.clientId}:lane-b:intake:citation-dismissed-evidence:${input.sourceRequestId}`
    : `${input.clientId}:lane-b:intake:citation-dismissed-evidence:onboarding`;
  const requestedItems = requestItemsForGenericCitation();
  const definition = LANE_B_EVIDENCE_TAXONOMY["citation-dismissed"];
  const result = await insertRequestIfMissing(service, {
    clientId: input.clientId,
    requestType: "evidence",
    dedupeKey,
    evidenceClass: "citation-dismissed",
    violationId: null,
    caseId: null,
    potentialPoints: null,
    itemKeys: requestedItems.map((item) => item.itemKey),
    trigger: input.trigger,
    title: definition.title,
    whyCopy:
      "A certified favorable court disposition can support removing the related roadside violation.",
    payload: {
      client_id: input.clientId,
      dedupe_key: dedupeKey,
      category: "lane_b_evidence",
      title: definition.title,
      description: definition.ask,
      why_copy:
        "A certified favorable court disposition can support removing the related roadside violation.",
      source: "standing",
      responsibility: "client",
      request_type: "evidence",
      evidence_class: "citation-dismissed",
      evidence_status: "open",
      requested_items: requestedItems,
      status: "open",
      status_copy: definition.ask,
      next_reminder_at: nextReminderAt(now),
      updated_at: now.toISOString(),
    },
  });
  return { requestId: result.row.id, generic: true };
}

export async function reconcileLaneBEvidenceLoopForClient(
  service: SupabaseLike,
  input: {
    clientId: string;
    trigger: LaneBReconcileTrigger;
    now?: Date;
  }
): Promise<LaneBLoopReconcileResult> {
  const [evidence, intake] = await Promise.all([
    reconcileLaneBEvidenceRequests(service, input),
    ensureCitationDismissedIntakeQuestion(service, input),
  ]);
  const [clientResult, questionResult] = await Promise.all([
    service
      .from("clients")
      .select("citation_dismissed_last_24_months")
      .eq("id", input.clientId)
      .single(),
    service
      .from("client_requests")
      .select("id, response")
      .eq("client_id", input.clientId)
      .eq("request_type", "question")
      .eq("evidence_class", "citation-dismissed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const { data: client, error: clientError } = clientResult;
  if (clientError || !client) {
    throw new Error(
      `Unable to verify citation intake recovery state: ${
        clientError?.message ?? "client not found"
      }`
    );
  }
  if (questionResult.error) {
    throw new Error(
      `Unable to verify citation intake answer recovery: ${questionResult.error.message}`
    );
  }
  const storedAnswer =
    questionResult.data?.response &&
    typeof questionResult.data.response === "object" &&
    "answer" in questionResult.data.response &&
    (questionResult.data.response.answer === "yes" ||
      questionResult.data.response.answer === "no")
      ? questionResult.data.response.answer
      : null;
  const recoveredClientValue =
    storedAnswer === "yes" ? true : storedAnswer === "no" ? false : null;
  if (
    recoveredClientValue !== null &&
    client.citation_dismissed_last_24_months !== recoveredClientValue
  ) {
    const { data: recovered, error: recoveryError } = await service
      .from("clients")
      .update({ citation_dismissed_last_24_months: recoveredClientValue })
      .eq("id", input.clientId)
      .select("id")
      .maybeSingle();
    if (recoveryError || !recovered) {
      throw new Error(
        `Unable to recover citation intake client state: ${
          recoveryError?.message ?? "row not updated"
        }`
      );
    }
  }
  const effectiveClientAnswer =
    recoveredClientValue ?? client.citation_dismissed_last_24_months;
  const citationFollowup =
    effectiveClientAnswer === true
      ? await ensureCitationDispositionFollowup(service, input)
      : null;
  return {
    ...evidence,
    intakeQuestionId: intake.requestId,
    intakeQuestionCreated: intake.created,
    citationFollowupId: citationFollowup?.requestId ?? null,
  };
}
