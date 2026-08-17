import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateChecklist, evaluateSystemGates } from "@/lib/operator/checklist-rules";
import type {
  ChecklistAckContext,
  ChecklistCaseContext,
  ChecklistItem,
  ChecklistPortalUserContext,
  ChecklistReportContext,
  ChecklistRequestContext,
  ChecklistSnapshotContext,
  OperatorManualItem,
  OperatorWorkContext,
  SystemGateContext,
} from "@/lib/operator/checklist-types";
import { createServiceClient } from "@/lib/supabase/server";
import { isClientTier } from "@/lib/tiers";

const MAX_BATCH_ROWS = 1_000;
const TODAY_CLIENT_CONCURRENCY = 4;

type QueryError = { message: string; code?: string };
type CountedRows<T> = {
  data: T[] | null;
  error: QueryError | null;
  count: number | null;
};

type AuthUserFact = {
  id: string;
  lastSignInAt: string | null;
};

function requireCompleteRows<T>(label: string, result: CountedRows<T>): T[] {
  if (result.error) {
    throw new Error(`Unable to load ${label}: ${result.error.message}`);
  }
  const rows = result.data ?? [];
  if (result.count === null) {
    throw new Error(`Unable to prove ${label} completeness: exact count was not returned`);
  }
  if (result.count !== rows.length) {
    throw new Error(
      `Unable to load complete ${label}: received ${rows.length} of ${result.count} rows`
    );
  }
  return rows;
}

function deliveryDryRun(): boolean {
  return process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false";
}

export function systemGateContextFromEnvironment(): SystemGateContext {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  return {
    emailDeliveryDryRun: deliveryDryRun(),
    lexisNexisWebhookConfigured: Boolean(
      process.env.LEXISNEXIS_WEBHOOK_SECRET?.trim()
    ),
    stripeSecretKeyMode: stripeKey.startsWith("sk_test")
      ? "test"
      : stripeKey.startsWith("sk_live")
        ? "live"
        : "unset",
  };
}

type AssembleOptions = {
  service?: SupabaseClient;
  now?: string;
  authUsers?: AuthUserFact[];
};

async function loadAuthUserFacts(
  service: SupabaseClient
): Promise<AuthUserFact[]> {
  const result = await service.auth.admin.listUsers({
    page: 1,
    perPage: MAX_BATCH_ROWS,
  });
  if (result.error) {
    throw new Error(`Unable to load portal sign-in state: ${result.error.message}`);
  }
  if (
    typeof result.data.total === "number" &&
    result.data.total > result.data.users.length
  ) {
    throw new Error(
      `Unable to load complete portal sign-in state: received ${result.data.users.length} of ${result.data.total} auth users`
    );
  }
  return result.data.users.map((user) => ({
    id: user.id,
    lastSignInAt: user.last_sign_in_at ?? null,
  }));
}

/**
 * Load every fact used by the pure checklist rules in one concurrent batch.
 * Every unbounded collection carries an exact count; crossing the explicit
 * batch ceiling fails loudly instead of returning a false all-clear.
 */
export async function assembleClientWorkContext(
  clientId: string,
  options: AssembleOptions = {}
): Promise<OperatorWorkContext> {
  const service = options.service ?? (await createServiceClient());
  const now = options.now ?? new Date().toISOString();
  const authUsersPromise = options.authUsers
    ? Promise.resolve(options.authUsers)
    : loadAuthUserFacts(service);

  const [
    clientResult,
    snapshotsResult,
    alertsResult,
    reportsResult,
    requestsResult,
    dataqResult,
    cpdpResult,
    driversResult,
    driverDocumentsResult,
    vehiclesResult,
    clearinghouseResult,
    portalProfilesResult,
    manualItemsResult,
    acknowledgementsResult,
    authUsers,
  ] = await Promise.all([
    service
      .from("clients")
      .select("id, name, tier, status")
      .eq("id", clientId)
      .maybeSingle(),
    service
      .from("burden_snapshots")
      .select("id, captured_at, snapshot_date, source, total_points")
      .eq("client_id", clientId)
      .order("captured_at", { ascending: false })
      .limit(2),
    service
      .from("alerts")
      .select("id, created_at, acknowledged_at", { count: "exact" })
      .eq("client_id", clientId)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("reports")
      .select("id, type, status, sent_at, created_at", { count: "exact" })
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("client_requests")
      .select(
        "id, status, responsibility, request_type, evidence_status, escalated_at, next_reminder_at, created_at, upload_token",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("dataq_cases")
      .select(
        "id, case_number, status, created_at, filed_date, determination_outcome, determination_recorded_at",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("cpdp_cases")
      .select(
        "id, case_number, status, created_at, filed_date, determination_outcome, determination_recorded_at",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("drivers")
      .select(
        "id, full_name, status, cdl_expiry, medical_cert_expiry, source, approved_at, request_id, created_at",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("driver_documents")
      .select(
        "id, driver_id, doc_type, status, completed_date, expiry_date, document_id",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("vehicles")
      .select("id, unit_number, status, annual_inspection_date", {
        count: "exact",
      })
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("clearinghouse_records")
      .select("id, driver_id, query_date", { count: "exact" })
      .eq("client_id", clientId)
      .order("query_date", { ascending: false })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("users")
      .select("id", { count: "exact" })
      .eq("client_id", clientId)
      .eq("role", "client_user")
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("operator_manual_items")
      .select(
        "id, client_id, title, details, due_date, status, created_at, completed_at, deleted_at",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    service
      .from("operator_item_acks")
      .select(
        "id, rule_key, context_key, action, snoozed_until, created_at",
        { count: "exact" }
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(0, MAX_BATCH_ROWS - 1),
    authUsersPromise,
  ]);

  if (clientResult.error) {
    throw new Error(`Unable to load checklist client: ${clientResult.error.message}`);
  }
  if (!clientResult.data) {
    throw new Error(`Checklist client ${clientId} was not found`);
  }
  if (!isClientTier(clientResult.data.tier)) {
    throw new Error(
      `Checklist client ${clientId} has unsupported tier ${String(clientResult.data.tier)}`
    );
  }
  if (snapshotsResult.error) {
    throw new Error(
      `Unable to load latest burden snapshots: ${snapshotsResult.error.message}`
    );
  }

  const alerts = requireCompleteRows(
    "unacknowledged alerts",
    alertsResult as CountedRows<{
      id: string;
      created_at: string;
      acknowledged_at: string | null;
    }>
  );
  const reports = requireCompleteRows(
    "reports",
    reportsResult as CountedRows<{
      id: string;
      type: string;
      status: string;
      sent_at: string | null;
      created_at: string;
    }>
  );
  const requests = requireCompleteRows(
    "open client requests",
    requestsResult as CountedRows<{
      id: string;
      status: string;
      responsibility: string;
      request_type: "evidence" | "question" | "roster_collection" | null;
      evidence_status: string | null;
      escalated_at: string | null;
      next_reminder_at: string | null;
      created_at: string;
      upload_token: string;
    }>
  );
  const dataqCases = requireCompleteRows(
    "DataQ cases",
    dataqResult as CountedRows<{
      id: string;
      case_number: string | null;
      status: string;
      created_at: string;
      filed_date: string | null;
      determination_outcome: string | null;
      determination_recorded_at: string | null;
    }>
  );
  const cpdpCases = requireCompleteRows(
    "CPDP cases",
    cpdpResult as CountedRows<{
      id: string;
      case_number: string | null;
      status: string;
      created_at: string;
      filed_date: string | null;
      determination_outcome: string | null;
      determination_recorded_at: string | null;
    }>
  );
  const allDrivers = requireCompleteRows(
    "compliance drivers",
    driversResult as CountedRows<
      OperatorWorkContext["compliance"]["drivers"][number] & {
        source: "operator" | "client_portal";
        request_id: string | null;
        created_at: string;
      }
    >
  );
  const drivers = allDrivers.filter((driver) => driver.approved_at !== null);
  const pendingDrivers = allDrivers
    .filter(
      (driver) =>
        driver.source === "client_portal" && driver.approved_at === null
    )
    .map((driver) => ({
      id: driver.id,
      fullName: driver.full_name,
      requestId: driver.request_id,
      createdAt: driver.created_at,
    }));
  const driverDocuments = requireCompleteRows(
    "driver qualification documents",
    driverDocumentsResult as CountedRows<
      OperatorWorkContext["compliance"]["driverDocuments"][number]
    >
  );
  const vehicles = requireCompleteRows(
    "compliance vehicles",
    vehiclesResult as CountedRows<OperatorWorkContext["compliance"]["vehicles"][number]>
  );
  const clearinghouseRecords = requireCompleteRows(
    "Clearinghouse records",
    clearinghouseResult as CountedRows<
      OperatorWorkContext["compliance"]["clearinghouseRecords"][number]
    >
  );
  const portalProfiles = requireCompleteRows(
    "linked portal users",
    portalProfilesResult as CountedRows<{ id: string }>
  );
  const manualRows = requireCompleteRows(
    "operator manual items",
    manualItemsResult as CountedRows<{
      id: string;
      client_id: string;
      title: string;
      details: string | null;
      due_date: string | null;
      status: "open" | "done";
      created_at: string;
      completed_at: string | null;
      deleted_at: string | null;
    }>
  );
  const acknowledgementRows = requireCompleteRows(
    "operator acknowledgements",
    acknowledgementsResult as CountedRows<{
      id: string;
      rule_key: string;
      context_key: string;
      action: "done" | "snooze";
      snoozed_until: string | null;
      created_at: string;
    }>
  );

  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const portalUsers: ChecklistPortalUserContext[] = portalProfiles.map(
    (profile) => {
      const authUser = authById.get(profile.id);
      if (!authUser) {
        throw new Error(
          `Unable to load sign-in state for linked portal user ${profile.id}`
        );
      }
      return { id: profile.id, lastSignInAt: authUser.lastSignInAt };
    }
  );

  const snapshots: ChecklistSnapshotContext[] = (snapshotsResult.data ?? []).map(
    (snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.captured_at,
      snapshotDate: snapshot.snapshot_date,
      source: snapshot.source,
      totalPoints: snapshot.total_points,
    })
  );
  const reportFacts: ChecklistReportContext[] = reports.map((report) => ({
    id: report.id,
    type: report.type,
    status: report.status,
    sentAt: report.sent_at,
    createdAt: report.created_at,
  }));
  const requestBaseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
  ).replace(/\/+$/, "");
  const requestFacts: ChecklistRequestContext[] = requests.map((request) => ({
    id: request.id,
    status: request.status,
    responsibility: request.responsibility,
    requestType: request.request_type,
    evidenceStatus: request.evidence_status,
    escalatedAt: request.escalated_at,
    nextReminderAt: request.next_reminder_at,
    createdAt: request.created_at,
    uploadToken: request.upload_token,
    uploadUrl: `${requestBaseUrl}/roster/${request.upload_token}`,
  }));
  const caseFacts: ChecklistCaseContext[] = [
    ...dataqCases.map((reportCase) => ({
      id: reportCase.id,
      kind: "DataQ" as const,
      caseNumber: reportCase.case_number,
      status: reportCase.status,
      createdAt: reportCase.created_at,
      filedDate: reportCase.filed_date,
      determinationOutcome: reportCase.determination_outcome,
    })),
    ...cpdpCases.map((reportCase) => ({
      id: reportCase.id,
      kind: "CPDP" as const,
      caseNumber: reportCase.case_number,
      status: reportCase.status,
      createdAt: reportCase.created_at,
      filedDate: reportCase.filed_date,
      determinationOutcome: reportCase.determination_outcome,
    })),
  ];
  const acknowledgements: ChecklistAckContext[] = acknowledgementRows.map(
    (ack) => ({
      id: ack.id,
      ruleKey: ack.rule_key,
      contextKey: ack.context_key,
      action: ack.action,
      snoozedUntil: ack.snoozed_until,
      createdAt: ack.created_at,
    })
  );
  const manualItems: OperatorManualItem[] = manualRows.map((manual) => ({
    id: manual.id,
    clientId: manual.client_id,
    title: manual.title,
    details: manual.details,
    dueDate: manual.due_date,
    status: manual.status,
    createdAt: manual.created_at,
    completedAt: manual.completed_at,
    deletedAt: manual.deleted_at,
  }));

  return {
    now,
    emailDeliveryDryRun: deliveryDryRun(),
    client: {
      id: clientResult.data.id,
      name: clientResult.data.name,
      tier: clientResult.data.tier,
      status: clientResult.data.status,
    },
    snapshots,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      createdAt: alert.created_at,
      acknowledgedAt: alert.acknowledged_at,
    })),
    reports: reportFacts,
    requests: requestFacts,
    cases: caseFacts,
    compliance: {
      available: true,
      drivers,
      pendingDrivers,
      driverDocuments,
      vehicles,
      clearinghouseRecords,
    },
    portalUsers,
    manualItems,
    acknowledgements,
  };
}

export async function getClientChecklist(
  clientId: string,
  options: AssembleOptions = {}
): Promise<{ items: ChecklistItem[]; manualItems: OperatorManualItem[] }> {
  const context = await assembleClientWorkContext(clientId, options);
  return {
    items: evaluateChecklist(context),
    manualItems: context.manualItems,
  };
}

export type TodayChecklistItem = ChecklistItem & {
  clientId: string;
  clientName: string;
};

export async function getOperatorToday(options: AssembleOptions = {}): Promise<{
  items: TodayChecklistItem[];
  gates: ChecklistItem[];
}> {
  const service = options.service ?? (await createServiceClient());
  const now = options.now ?? new Date().toISOString();
  const [clientsResult, authUsers] = await Promise.all([
    service
      .from("clients")
      .select("id", { count: "exact" })
      .order("name", { ascending: true })
      .range(0, MAX_BATCH_ROWS - 1),
    options.authUsers
      ? Promise.resolve(options.authUsers)
      : loadAuthUserFacts(service),
  ]);
  const clients = requireCompleteRows(
    "Today clients",
    clientsResult as CountedRows<{ id: string }>
  );

  const contexts: OperatorWorkContext[] = [];
  for (let index = 0; index < clients.length; index += TODAY_CLIENT_CONCURRENCY) {
    const batch = clients.slice(index, index + TODAY_CLIENT_CONCURRENCY);
    contexts.push(
      ...(await Promise.all(
        batch.map((client) =>
          assembleClientWorkContext(client.id, { service, now, authUsers })
        )
      ))
    );
  }
  const items = contexts
    .flatMap((context) =>
      evaluateChecklist(context)
        .filter((itemValue) => itemValue.state === "needs_you")
        .map(
          (itemValue): TodayChecklistItem => ({
            ...itemValue,
            title: `${context.client.name}: ${itemValue.title}`,
            href:
              itemValue.href.trim() ||
              `/console/clients/${context.client.id}/checklist`,
            clientId: context.client.id,
            clientName: context.client.name,
          })
        )
    )
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
    );

  return {
    items,
    gates: evaluateSystemGates(systemGateContextFromEnvironment()),
  };
}
