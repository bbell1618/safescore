import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChecklistItem } from "../lib/operator/checklist-types";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const CLIENT_ID = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const EXPECTED_BILLING_DRIVER_COUNT = 5;
const DEDUPE_KEY = `roster_collection:${CLIENT_ID}`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_TOKEN = "00000000-0000-4000-8000-000000000001";
const TEST_DRIVER_NAME = "TEST—Run G Roster Driver";
const UPDATED_DRIVER_NAME = "TEST—Run G Roster Driver Updated";
const REMOVED_DRIVER_NAME = "TEST—Run G Removed Driver";
const ROSTER_TITLE = "Driver roster & qualification documents";
const RUN_LIVE = process.argv.includes("--run-live");
const baseUrlArg = process.argv.find((value) =>
  value.startsWith("--base-url=")
);
const BASE_URL = (
  baseUrlArg?.slice("--base-url=".length) ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://safescore.vercel.app"
).replace(/\/+$/, "");

type JsonRecord = Record<string, unknown>;
type RouteResult = {
  status: number;
  body: unknown;
};
type TextRouteResult = {
  status: number;
  body: string;
  location: string | null;
};
type ChecklistPayload = {
  items: ChecklistItem[];
  manualItems: unknown[];
};
type TodayItem = ChecklistItem & {
  clientId: string;
  clientName: string;
};
type TodayPayload = {
  items: TodayItem[];
  gates: ChecklistItem[];
};
type Baseline = {
  client: {
    id: string;
    name: string;
    tier: string;
    status: string;
    driver_count: number | null;
    updated_at: string;
  };
  drivers: number;
  openRosterRequests: number;
  totalRosterRequests: number;
  protectedCounts: Record<string, number>;
};
type CleanupArtifacts = {
  requestId: string | null;
  driverIds: Set<string>;
  documentIds: Set<string>;
  driverDocumentIds: Set<string>;
  activityIds: Set<string>;
  storagePaths: Set<string>;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonRecord {
  assert.ok(isRecord(value), `${label} was not an object`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} was not a string`);
  return value as string;
}

function arrayValue(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} was not an array`);
  return value;
}

function redact(value: string, bearerToken: string | null): string {
  let result = value;
  if (bearerToken) result = result.replaceAll(bearerToken, "[redacted]");
  result = result.replace(
    /\/roster\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,
    "/roster/[redacted]"
  );
  return result;
}

function errorMessage(error: unknown, bearerToken: string | null): string {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message, bearerToken);
}

async function jsonBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { nonJson: raw.slice(0, 500) };
  }
}

async function callJson(input: {
  path: string;
  method?: string;
  cookie?: string;
  body?: unknown;
  form?: FormData;
}): Promise<RouteResult> {
  const method = input.method ?? "GET";
  const response = await fetch(`${BASE_URL}${input.path}`, {
    method,
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(input.body !== undefined
      ? { body: JSON.stringify(input.body) }
      : input.form
        ? { body: input.form }
        : {}),
    redirect: "manual",
  });
  return { status: response.status, body: await jsonBody(response) };
}

async function callText(input: {
  path: string;
  cookie?: string;
}): Promise<TextRouteResult> {
  const response = await fetch(`${BASE_URL}${input.path}`, {
    headers: input.cookie ? { cookie: input.cookie } : undefined,
    redirect: "manual",
  });
  return {
    status: response.status,
    body: await response.text(),
    location: response.headers.get("location"),
  };
}

async function exactCount(
  service: SupabaseClient,
  table: string,
  clientId: string
): Promise<number> {
  const result = await service
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (result.error) {
    throw new Error(`Unable to count ${table}: ${result.error.message}`);
  }
  return result.count ?? 0;
}

async function loadBaseline(service: SupabaseClient): Promise<Baseline> {
  const [
    clientResult,
    driversResult,
    openRosterResult,
    totalRosterResult,
    violations,
    inspections,
    reports,
    dataqCases,
    cpdpCases,
    manualItems,
    acknowledgements,
  ] = await Promise.all([
    service
      .from("clients")
      .select("id, name, tier, status, driver_count, updated_at")
      .eq("id", CLIENT_ID)
      .single(),
    service
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("client_id", CLIENT_ID),
    service
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", CLIENT_ID)
      .eq("request_type", "roster_collection")
      .eq("status", "open"),
    service
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", CLIENT_ID)
      .eq("request_type", "roster_collection"),
    exactCount(service, "violations", CLIENT_ID),
    exactCount(service, "inspections", CLIENT_ID),
    exactCount(service, "reports", CLIENT_ID),
    exactCount(service, "dataq_cases", CLIENT_ID),
    exactCount(service, "cpdp_cases", CLIENT_ID),
    exactCount(service, "operator_manual_items", CLIENT_ID),
    exactCount(service, "operator_item_acks", CLIENT_ID),
  ]);
  const firstError = [
    clientResult.error,
    driversResult.error,
    openRosterResult.error,
    totalRosterResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  return {
    client: clientResult.data as Baseline["client"],
    drivers: driversResult.count ?? 0,
    openRosterRequests: openRosterResult.count ?? 0,
    totalRosterRequests: totalRosterResult.count ?? 0,
    protectedCounts: {
      violations,
      inspections,
      reports,
      dataq_cases: dataqCases,
      cpdp_cases: cpdpCases,
      operator_manual_items: manualItems,
      operator_item_acks: acknowledgements,
    },
  };
}

function assertExactBaseline(baseline: Baseline) {
  assert.equal(baseline.client.id, CLIENT_ID);
  assert.equal(baseline.client.name, "Nationwide Carrier Inc");
  assert.equal(baseline.client.tier, "total_safety");
  assert.equal(baseline.client.status, "active");
  assert.equal(
    baseline.client.driver_count,
    EXPECTED_BILLING_DRIVER_COUNT,
    "The billing driver count changed; refuse the write proof."
  );
  assert.equal(
    baseline.drivers,
    0,
    "Nationwide no longer has the exact zero-driver Run G baseline."
  );
  assert.equal(
    baseline.openRosterRequests,
    0,
    "Nationwide already has an open roster request; refuse the write proof."
  );
  assert.equal(
    baseline.totalRosterRequests,
    0,
    "Nationwide already has roster-collection history; refuse destructive verifier cleanup."
  );
}

function checklist(value: unknown): ChecklistPayload {
  const body = record(value, "checklist response");
  return {
    items: arrayValue(body.items, "checklist items") as ChecklistItem[],
    manualItems: arrayValue(body.manualItems, "manual items"),
  };
}

function today(value: unknown): TodayPayload {
  const body = record(value, "Today response");
  return {
    items: arrayValue(body.items, "Today items") as TodayItem[],
    gates: arrayValue(body.gates, "Today gates") as ChecklistItem[],
  };
}

function evidenceRuleCount(items: ChecklistItem[]): number {
  return items.filter((item) => item.ruleKey.startsWith("evidence.")).length;
}

function syntheticPdf(label: string): Blob {
  const body = `%PDF-1.4\n% SafeScore ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return new Blob([body], { type: "application/pdf" });
}

async function pauseForBrowserReview(input: {
  requestId: string;
  driverId: string;
  stage: "before_approval" | "after_approval";
}) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      "The live verifier requires an interactive TTY for its mandatory browser-review checkpoint."
    );
  }

  const beforeApproval = input.stage === "before_approval";
  console.log(
    JSON.stringify(
      {
        checkpoint: beforeApproval
          ? "browser_review_before_staff_approval"
          : "browser_review_after_staff_approval",
        fixturesRemainLive: true,
        bearerTokenPrinted: false,
        requestId: input.requestId,
        driverId: input.driverId,
        staffSurfaces: beforeApproval
          ? [
              `/console/clients/${CLIENT_ID}/compliance`,
              `/console/clients/${CLIENT_ID}/requests`,
              "/console",
            ]
          : [`/console/clients/${CLIENT_ID}/compliance`],
        portalSurfaces: beforeApproval
          ? ["/portal/documents", "/portal/compliance"]
          : ["/portal/compliance"],
        publicWizard: beforeApproval
          ? "Open the copyable roster link from the authenticated Requests surface; the bearer URL is intentionally never printed."
          : "The public wizard keeps the reviewed request-linked row visible and read-only until staff closes the request.",
        resume: beforeApproval
          ? "After browser evidence is captured, return to this terminal and press Enter. Approval runs only after that input."
          : "After the approved-only surfaces are captured, return and press Enter. Closure and exact cleanup run only after that input.",
      },
      null,
      2
    )
  );

  const prompt = createInterface({ input: stdin, output: stdout });
  let rejectInterrupt: (reason: Error) => void = () => undefined;
  const interrupt = new Promise<never>((_resolve, reject) => {
    rejectInterrupt = reject;
  });
  const onPromptInterrupt = () =>
    rejectInterrupt(
      new Error(
        "Browser review was interrupted; approval is skipped and exact cleanup will run."
      )
    );
  const onTermination = () =>
    rejectInterrupt(
      new Error(
        "Browser review received SIGTERM; approval is skipped and exact cleanup will run."
      )
    );
  prompt.once("SIGINT", onPromptInterrupt);
  process.once("SIGTERM", onTermination);
  try {
    await Promise.race([
      prompt.question(
        beforeApproval
          ? "Pre-approval browser review complete; press Enter to approve: "
          : "Post-approval browser review complete; press Enter to close and clean up: "
      ),
      interrupt,
    ]);
  } finally {
    prompt.off("SIGINT", onPromptInterrupt);
    process.off("SIGTERM", onTermination);
    prompt.close();
  }
}

async function uploadRosterDocument(input: {
  token: string;
  driverId: string;
  docType: "cdl" | "medical_cert";
}) {
  const form = new FormData();
  form.set("docType", input.docType);
  form.set(
    "file",
    syntheticPdf(input.docType),
    `TEST-run-g-${input.docType}.pdf`
  );
  return callJson({
    path: `/api/roster/${input.token}/drivers/${input.driverId}/documents`,
    method: "POST",
    form,
  });
}

async function captureCleanupRows(
  service: SupabaseClient,
  artifacts: CleanupArtifacts,
  runStartedAt: string
) {
  if (!artifacts.requestId) {
    const requestResult = await service
      .from("client_requests")
      .select("id")
      .eq("client_id", CLIENT_ID)
      .eq("dedupe_key", DEDUPE_KEY)
      .maybeSingle();
    if (requestResult.error) throw requestResult.error;
    if (requestResult.data?.id) artifacts.requestId = requestResult.data.id;
  }
  if (!artifacts.requestId) return;

  const driversResult = await service
    .from("drivers")
    .select("id")
    .eq("client_id", CLIENT_ID)
    .eq("request_id", artifacts.requestId)
    .eq("source", "client_portal");
  if (driversResult.error) throw driversResult.error;
  for (const row of driversResult.data ?? []) artifacts.driverIds.add(row.id);

  const driverIds = [...artifacts.driverIds];
  if (driverIds.length > 0) {
    const linksResult = await service
      .from("driver_documents")
      .select("id, document_id")
      .eq("client_id", CLIENT_ID)
      .in("driver_id", driverIds);
    if (linksResult.error) throw linksResult.error;
    for (const row of linksResult.data ?? []) {
      artifacts.driverDocumentIds.add(row.id);
      if (row.document_id) artifacts.documentIds.add(row.document_id);
    }
  }

  const documentsResult = await service
    .from("documents")
    .select("id, storage_path")
    .eq("client_id", CLIENT_ID)
    .eq("client_request_id", artifacts.requestId);
  if (documentsResult.error) throw documentsResult.error;
  for (const row of documentsResult.data ?? []) {
    artifacts.documentIds.add(row.id);
    artifacts.storagePaths.add(row.storage_path);
  }

  for (const driverId of driverIds) {
    for (const docType of ["cdl", "medical_cert"] as const) {
      const prefix = `${CLIENT_ID}/requests/${artifacts.requestId}/drivers/${driverId}/${docType}`;
      const listed = await service.storage.from("documents").list(prefix, {
        limit: 1_000,
      });
      if (listed.error) throw listed.error;
      for (const object of listed.data ?? []) {
        artifacts.storagePaths.add(`${prefix}/${object.name}`);
      }
    }
  }

  const entityIds = [artifacts.requestId, ...driverIds];
  const activitiesResult = await service
    .from("activity_log")
    .select("id, action_type, entity_id")
    .eq("client_id", CLIENT_ID)
    .gte("created_at", runStartedAt)
    .in("entity_id", entityIds);
  if (activitiesResult.error) throw activitiesResult.error;
  for (const row of activitiesResult.data ?? []) artifacts.activityIds.add(row.id);
}

async function cleanupExactArtifacts(
  service: SupabaseClient,
  artifacts: CleanupArtifacts,
  runStartedAt: string
): Promise<string[]> {
  const failures: string[] = [];
  try {
    await captureCleanupRows(service, artifacts, runStartedAt);
  } catch (error) {
    failures.push(`capture cleanup rows: ${errorMessage(error, null)}`);
  }

  const storagePaths = [...artifacts.storagePaths];
  if (storagePaths.length > 0) {
    const result = await service.storage.from("documents").remove(storagePaths);
    if (result.error) failures.push(`storage: ${result.error.message}`);
  }

  const driverDocumentIds = [...artifacts.driverDocumentIds];
  if (driverDocumentIds.length > 0) {
    const result = await service
      .from("driver_documents")
      .delete()
      .eq("client_id", CLIENT_ID)
      .in("id", driverDocumentIds);
    if (result.error) failures.push(`driver_documents: ${result.error.message}`);
  }

  const driverIds = [...artifacts.driverIds];
  if (driverIds.length > 0) {
    const result = await service
      .from("drivers")
      .delete()
      .eq("client_id", CLIENT_ID)
      .eq("source", "client_portal")
      .in("id", driverIds);
    if (result.error) failures.push(`drivers: ${result.error.message}`);
  }

  const documentIds = [...artifacts.documentIds];
  if (documentIds.length > 0) {
    const result = await service
      .from("documents")
      .delete()
      .eq("client_id", CLIENT_ID)
      .in("id", documentIds);
    if (result.error) failures.push(`documents: ${result.error.message}`);
  }

  const activityIds = [...artifacts.activityIds];
  if (activityIds.length > 0) {
    const result = await service
      .from("activity_log")
      .delete()
      .eq("client_id", CLIENT_ID)
      .in("id", activityIds);
    if (result.error) failures.push(`activity_log: ${result.error.message}`);
  }

  if (artifacts.requestId) {
    const result = await service
      .from("client_requests")
      .delete()
      .eq("id", artifacts.requestId)
      .eq("client_id", CLIENT_ID)
      .eq("dedupe_key", DEDUPE_KEY);
    if (result.error) failures.push(`client_requests: ${result.error.message}`);
  }
  return failures;
}

async function assertFinalState(
  service: SupabaseClient,
  baseline: Baseline,
  artifacts: CleanupArtifacts
) {
  const after = await loadBaseline(service);
  assert.deepEqual(after.client, baseline.client, "The protected client row changed.");
  assert.deepEqual(
    after.protectedCounts,
    baseline.protectedCounts,
    "A protected production table count changed."
  );
  assert.equal(after.drivers, baseline.drivers);
  assert.equal(after.openRosterRequests, 0);
  assert.equal(after.totalRosterRequests, 0);
  assert.equal(after.client.driver_count, EXPECTED_BILLING_DRIVER_COUNT);

  if (artifacts.requestId) {
    const [documents, drivers] = await Promise.all([
      service
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("client_request_id", artifacts.requestId),
      service
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("request_id", artifacts.requestId),
    ]);
    if (documents.error || drivers.error) {
      throw documents.error ?? drivers.error;
    }
    assert.equal(documents.count ?? 0, 0);
    assert.equal(drivers.count ?? 0, 0);
  }

  const driverDocumentIds = [...artifacts.driverDocumentIds];
  if (driverDocumentIds.length > 0) {
    const remaining = await service
      .from("driver_documents")
      .select("id", { count: "exact", head: true })
      .in("id", driverDocumentIds);
    if (remaining.error) throw remaining.error;
    assert.equal(remaining.count ?? 0, 0);
  }

  const activityIds = [...artifacts.activityIds];
  if (activityIds.length > 0) {
    const remaining = await service
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .in("id", activityIds);
    if (remaining.error) throw remaining.error;
    assert.equal(remaining.count ?? 0, 0);
  }

  for (const storagePath of artifacts.storagePaths) {
    const lastSlash = storagePath.lastIndexOf("/");
    const prefix = storagePath.slice(0, lastSlash);
    const name = storagePath.slice(lastSlash + 1);
    const listed = await service.storage.from("documents").list(prefix, {
      limit: 100,
      search: name,
    });
    if (listed.error) throw listed.error;
    assert.equal(
      (listed.data ?? []).some((object) => object.name === name),
      false,
      "A Run G verifier storage object survived cleanup."
    );
  }
  return after;
}

async function main() {
  const productionUrl = new URL(BASE_URL);
  assert.equal(productionUrl.protocol, "https:", "Use an HTTPS deployment URL.");

  const service = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const baseline = await loadBaseline(service);
  assertExactBaseline(baseline);

  if (!RUN_LIVE) {
    console.log(
      JSON.stringify(
        {
          passed: true,
          mode: "read_only",
          writesExecuted: false,
          guard: "Pass --run-live to execute the authorized reversible proof.",
          baseUrl: BASE_URL,
          baseline: {
            drivers: baseline.drivers,
            openRosterRequests: baseline.openRosterRequests,
            totalRosterRequests: baseline.totalRosterRequests,
            billingDriverCount: baseline.client.driver_count,
            protectedCounts: baseline.protectedCounts,
          },
        },
        null,
        2
      )
    );
    return;
  }

  assert.equal(
    process.env.EMAIL_DRY_RUN?.trim().toLowerCase(),
    "true",
    "EMAIL_DRY_RUN must be explicitly true before this proof may write."
  );

  const portalUser = await service
    .from("users")
    .select("id, email")
    .eq("client_id", CLIENT_ID)
    .eq("role", "client_user")
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (portalUser.error || !portalUser.data?.email) {
    throw portalUser.error ?? new Error("Nationwide has no linked portal user email.");
  }

  const runStartedAt = new Date().toISOString();
  const artifacts: CleanupArtifacts = {
    requestId: null,
    driverIds: new Set(),
    documentIds: new Set(),
    driverDocumentIds: new Set(),
    activityIds: new Set(),
    storagePaths: new Set(),
  };
  let bearerToken: string | null = null;
  let staff: Awaited<ReturnType<typeof createDeployedStaffSession>> | null = null;
  let portal: Awaited<ReturnType<typeof createDeployedClientSession>> | null = null;
  let proofFailure: string | null = null;
  const cleanupFailures: string[] = [];
  const proof: JsonRecord = {
    auth: {},
    request: {},
    publicWizard: {},
    checklist: {},
    review: {},
    close: {},
  };

  try {
    staff = await createDeployedStaffSession(BASE_URL);
    portal = await createDeployedClientSession(
      BASE_URL,
      portalUser.data.email
    );

    const baselineChecklistRoute = await callJson({
      path: `/api/clients/${CLIENT_ID}/checklist`,
      cookie: staff.cookie,
    });
    assert.equal(baselineChecklistRoute.status, 200);
    const baselineChecklist = checklist(baselineChecklistRoute.body);
    const baselineEvidenceRules = evidenceRuleCount(baselineChecklist.items);

    const [unauthCreate, portalCreate] = await Promise.all([
      callJson({
        path: `/api/clients/${CLIENT_ID}/driver-roster-request`,
        method: "POST",
      }),
      callJson({
        path: `/api/clients/${CLIENT_ID}/driver-roster-request`,
        method: "POST",
        cookie: portal.cookie,
      }),
    ]);
    assert.equal(unauthCreate.status, 401);
    assert.equal(portalCreate.status, 403);
    proof.auth = {
      staffRouteWithoutSession: unauthCreate.status,
      staffRouteAsPortalUser: portalCreate.status,
    };

    const created = await callJson({
      path: `/api/clients/${CLIENT_ID}/driver-roster-request`,
      method: "POST",
      cookie: staff.cookie,
    });
    assert.equal(created.status, 201);
    const createdBody = record(created.body, "roster request response");
    const createdRequest = record(createdBody.request, "created request");
    artifacts.requestId = stringValue(createdRequest.id, "request id");
    assert.match(artifacts.requestId, UUID_PATTERN);
    assert.equal(createdRequest.created, true);
    const createdDelivery = record(
      createdBody.emailDelivery,
      "roster email delivery"
    );
    assert.equal(createdDelivery.status, "dry_run");
    assert.equal(createdDelivery.dryRun, true);

    const returnedRosterUrl = new URL(
      stringValue(createdBody.rosterUrl, "roster URL")
    );
    const rosterSegments = returnedRosterUrl.pathname.split("/").filter(Boolean);
    assert.deepEqual(rosterSegments.slice(0, 1), ["roster"]);
    assert.equal(rosterSegments.length, 2);
    bearerToken = rosterSegments[1] ?? null;
    assert.ok(bearerToken);
    assert.match(bearerToken, UUID_PATTERN);

    const duplicate = await callJson({
      path: `/api/clients/${CLIENT_ID}/driver-roster-request`,
      method: "POST",
      cookie: staff.cookie,
    });
    assert.equal(duplicate.status, 200);
    const duplicateBody = record(duplicate.body, "duplicate request response");
    const duplicateRequest = record(duplicateBody.request, "duplicate request");
    assert.equal(duplicateRequest.id, artifacts.requestId);
    assert.equal(duplicateRequest.created, false);
    assert.equal(duplicateRequest.reopened, false);
    assert.equal(
      record(duplicateBody.emailDelivery, "duplicate delivery").status,
      "skipped"
    );
    proof.request = {
      id: artifacts.requestId,
      firstStatus: created.status,
      duplicateStatus: duplicate.status,
      duplicateReturnedSameId: true,
      emailDelivery: "dry_run",
      rosterUrlFormat: "/roster/[redacted]",
    };

    const [publicPage, initialApi, invalidApi] = await Promise.all([
      callText({ path: `/roster/${bearerToken}` }),
      callJson({ path: `/api/roster/${bearerToken}` }),
      callJson({ path: `/api/roster/${INVALID_TOKEN}` }),
    ]);
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.location, null);
    assert.match(publicPage.body, /Secure driver-list collection/);
    assert.equal(initialApi.status, 200);
    assert.equal(
      arrayValue(record(initialApi.body, "initial roster").drivers, "drivers")
        .length,
      0
    );
    assert.equal(invalidApi.status, 404);

    const injectedClientId = await callJson({
      path: `/api/roster/${bearerToken}/drivers`,
      method: "POST",
      body: {
        client_id: "95139fb1-2d8d-4e1e-b90b-45e47fef08ae",
        full_name: TEST_DRIVER_NAME,
        cdl_number: "RUN-G-INJECTED",
      },
    });
    assert.equal(injectedClientId.status, 400);
    assert.equal(await exactCount(service, "drivers", CLIENT_ID), 0);

    const driverCreated = await callJson({
      path: `/api/roster/${bearerToken}/drivers`,
      method: "POST",
      body: {
        full_name: TEST_DRIVER_NAME,
        cdl_number: "RUN-G-001",
        cdl_state: "NV",
        cdl_class: "B",
        cdl_expiry: null,
        medical_cert_expiry: null,
        hired_date: "2026-01-15",
      },
    });
    assert.equal(driverCreated.status, 201);
    const createdDriver = record(
      record(driverCreated.body, "driver create body").driver,
      "created driver"
    );
    const driverId = stringValue(createdDriver.id, "created driver id");
    assert.match(driverId, UUID_PATTERN);
    artifacts.driverIds.add(driverId);
    assert.equal(createdDriver.cdlState, "NV");
    assert.equal(createdDriver.cdlClass, "B");
    assert.equal(createdDriver.approvedAt, null);

    const rejectedPublicPatch = await callJson({
      path: `/api/roster/${bearerToken}/drivers/${driverId}`,
      method: "PATCH",
      body: { approved_at: new Date().toISOString() },
    });
    assert.equal(rejectedPublicPatch.status, 400);
    assert.equal(
      record(rejectedPublicPatch.body, "strict public patch response").code,
      "ROSTER_DRIVER_INVALID"
    );

    const resumed = await callJson({ path: `/api/roster/${bearerToken}` });
    assert.equal(resumed.status, 200);
    assert.equal(
      arrayValue(record(resumed.body, "resumed roster").drivers, "drivers")
        .length,
      1
    );

    const patched = await callJson({
      path: `/api/roster/${bearerToken}/drivers/${driverId}`,
      method: "PATCH",
      body: { full_name: UPDATED_DRIVER_NAME },
    });
    assert.equal(patched.status, 200);
    const patchedDriver = record(
      record(patched.body, "driver patch body").driver,
      "patched driver"
    );
    assert.equal(patchedDriver.fullName, UPDATED_DRIVER_NAME);
    assert.equal(patchedDriver.cdlState, "NV");
    assert.equal(patchedDriver.cdlClass, "B");

    for (const docType of ["cdl", "medical_cert"] as const) {
      const upload = await uploadRosterDocument({
        token: bearerToken,
        driverId,
        docType,
      });
      assert.equal(upload.status, 201);
      const document = record(
        record(upload.body, `${docType} upload body`).document,
        `${docType} document`
      );
      const documentId = stringValue(document.id, `${docType} document id`);
      const driverDocumentId = stringValue(
        document.driverDocumentId,
        `${docType} driver-document id`
      );
      artifacts.documentIds.add(documentId);
      artifacts.driverDocumentIds.add(driverDocumentId);
      assert.equal(document.docType, docType);
      assert.equal(document.reviewStatus, "pending_review");
    }

    const removable = await callJson({
      path: `/api/roster/${bearerToken}/drivers`,
      method: "POST",
      body: {
        full_name: REMOVED_DRIVER_NAME,
        cdl_number: "RUN-G-REMOVE",
        cdl_state: "CA",
        cdl_class: "A",
      },
    });
    assert.equal(removable.status, 201);
    const removableDriver = record(
      record(removable.body, "removable driver body").driver,
      "removable driver"
    );
    const removableDriverId = stringValue(
      removableDriver.id,
      "removable driver id"
    );
    artifacts.driverIds.add(removableDriverId);
    const removed = await callJson({
      path: `/api/roster/${bearerToken}/drivers/${removableDriverId}`,
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.equal(record(removed.body, "remove response").ok, true);

    const submitted = await callJson({
      path: `/api/roster/${bearerToken}/submit`,
      method: "POST",
    });
    assert.equal(submitted.status, 200);
    const submitBody = record(submitted.body, "submit response");
    assert.equal(submitBody.driverCount, 1);
    assert.equal(submitBody.response, "1 driver submitted");

    const genericUpload = await callJson({
      path: `/api/portal/requests/${artifacts.requestId}/upload`,
      method: "POST",
      cookie: portal.cookie,
    });
    assert.equal(genericUpload.status, 409);
    assert.equal(
      record(genericUpload.body, "generic upload guard").code,
      "ROSTER_WIZARD_REQUIRED"
    );

    const [checklistRoute, todayRoute] = await Promise.all([
      callJson({
        path: `/api/clients/${CLIENT_ID}/checklist`,
        cookie: staff.cookie,
      }),
      callJson({ path: "/api/operator/today", cookie: staff.cookie }),
    ]);
    assert.equal(checklistRoute.status, 200);
    assert.equal(todayRoute.status, 200);
    const checklistAfterSubmit = checklist(checklistRoute.body);
    const todayAfterSubmit = today(todayRoute.body);
    const rosterEmpty = checklistAfterSubmit.items.find(
      (item) => item.ruleKey === "compliance.roster_empty"
    );
    const rosterReview = checklistAfterSubmit.items.find(
      (item) => item.ruleKey === "compliance.roster_review"
    );
    assert.equal(rosterEmpty?.state, "waiting_client");
    assert.equal(rosterEmpty?.action?.kind, "copy_roster_link");
    assert.equal(rosterReview?.state, "needs_you");
    assert.ok(
      todayAfterSubmit.items.some(
        (item) =>
          item.clientId === CLIENT_ID &&
          item.ruleKey === "compliance.roster_review"
      )
    );
    assert.equal(
      evidenceRuleCount(checklistAfterSubmit.items),
      baselineEvidenceRules,
      "The roster request changed evidence.* checklist counts."
    );
    proof.checklist = {
      rosterEmptyState: rosterEmpty.state,
      rosterEmptyAction: rosterEmpty.action?.kind,
      rosterReviewState: rosterReview.state,
      todayIncludesRosterReview: true,
      evidenceRuleCountUnchanged: true,
    };

    const [consoleCompliance, consoleRequests, portalDocuments, portalCompliance] =
      await Promise.all([
        callText({
          path: `/console/clients/${CLIENT_ID}/compliance`,
          cookie: staff.cookie,
        }),
        callText({
          path: `/console/clients/${CLIENT_ID}/requests`,
          cookie: staff.cookie,
        }),
        callText({ path: "/portal/documents", cookie: portal.cookie }),
        callText({ path: "/portal/compliance", cookie: portal.cookie }),
      ]);
    for (const route of [
      consoleCompliance,
      consoleRequests,
      portalDocuments,
      portalCompliance,
    ]) {
      assert.equal(route.status, 200);
    }
    assert.match(consoleCompliance.body, /Client submissions pending review/);
    assert.match(consoleCompliance.body, new RegExp(UPDATED_DRIVER_NAME));
    const rosterTitleHtml = /Driver roster (?:&|&amp;) qualification documents/;
    assert.match(consoleRequests.body, rosterTitleHtml);
    assert.ok(consoleRequests.body.includes(`/roster/${bearerToken}`));
    assert.match(portalDocuments.body, rosterTitleHtml);
    assert.ok(portalDocuments.body.includes(`/roster/${bearerToken}`));
    assert.equal(portalCompliance.body.includes(UPDATED_DRIVER_NAME), false);

    const reviewPath = `/api/clients/${CLIENT_ID}/drivers/${driverId}/review`;
    const closePath = `/api/clients/${CLIENT_ID}/driver-roster-request/${artifacts.requestId}/close`;
    const [
      unauthReview,
      portalReview,
      unauthClose,
      portalClose,
      strictStaffReview,
      closeWithPendingReview,
    ] = await Promise.all([
      callJson({
        path: reviewPath,
        method: "PATCH",
        body: { action: "approve" },
      }),
      callJson({
        path: reviewPath,
        method: "PATCH",
        cookie: portal.cookie,
        body: { action: "approve" },
      }),
      callJson({ path: closePath, method: "POST" }),
      callJson({ path: closePath, method: "POST", cookie: portal.cookie }),
      callJson({
        path: reviewPath,
        method: "PATCH",
        cookie: staff.cookie,
        body: {
          action: "approve",
          updates: { notes: "This unknown field must be rejected." },
        },
      }),
      callJson({ path: closePath, method: "POST", cookie: staff.cookie }),
    ]);
    assert.equal(unauthReview.status, 401);
    assert.equal(portalReview.status, 403);
    assert.equal(unauthClose.status, 401);
    assert.equal(portalClose.status, 403);
    assert.equal(strictStaffReview.status, 400);
    assert.equal(
      record(strictStaffReview.body, "strict staff review response").code,
      "INVALID_DRIVER_REVIEW"
    );
    assert.equal(closeWithPendingReview.status, 409);
    assert.equal(
      record(closeWithPendingReview.body, "pending review close response").code,
      "ROSTER_REVIEW_PENDING"
    );
    const untouchedPendingDriver = await service
      .from("drivers")
      .select("id, approved_at, approved_by")
      .eq("id", driverId)
      .eq("client_id", CLIENT_ID)
      .single();
    if (untouchedPendingDriver.error) throw untouchedPendingDriver.error;
    assert.equal(untouchedPendingDriver.data.approved_at, null);
    assert.equal(untouchedPendingDriver.data.approved_by, null);
    proof.auth = {
      ...record(proof.auth, "auth proof"),
      reviewRouteWithoutSession: unauthReview.status,
      reviewRouteAsPortalUser: portalReview.status,
      closeRouteWithoutSession: unauthClose.status,
      closeRouteAsPortalUser: portalClose.status,
      strictStaffReviewStatus: strictStaffReview.status,
      closeBlockedWhileReviewPending: closeWithPendingReview.status,
    };

    await pauseForBrowserReview({
      requestId: artifacts.requestId,
      driverId,
      stage: "before_approval",
    });
    proof.browserCheckpoint = {
      reachedAfterSubmit: true,
      resumedBeforeApproval: true,
      bearerTokenPrinted: false,
    };

    const approved = await callJson({
      path: `/api/clients/${CLIENT_ID}/drivers/${driverId}/review`,
      method: "PATCH",
      cookie: staff.cookie,
      body: {
        action: "approve",
        updates: {
          full_name: UPDATED_DRIVER_NAME,
          cdl_number: "RUN-G-001",
          cdl_state: "NV",
          cdl_class: "B",
          cdl_expiry: "2028-12-31",
          medical_cert_expiry: "2028-11-30",
          hired_date: "2026-01-15",
          status: "active",
        },
      },
    });
    assert.equal(approved.status, 200);
    const approvedDriver = record(
      record(approved.body, "approve response").driver,
      "approved driver"
    );
    assert.equal(approvedDriver.id, driverId);
    assert.equal(approvedDriver.source, "client_portal");
    assert.equal(typeof approvedDriver.approved_at, "string");
    assert.equal(typeof approvedDriver.approved_by, "string");

    const [driverProof, documentProof, driverDocumentProof] = await Promise.all([
      service
        .from("drivers")
        .select("id, source, approved_at, approved_by, request_id")
        .eq("id", driverId)
        .eq("client_id", CLIENT_ID)
        .single(),
      service
        .from("documents")
        .select("id, status, storage_path")
        .eq("client_id", CLIENT_ID)
        .eq("client_request_id", artifacts.requestId)
        .order("id"),
      service
        .from("driver_documents")
        .select("id, doc_type, status, document_id")
        .eq("client_id", CLIENT_ID)
        .eq("driver_id", driverId)
        .order("doc_type"),
    ]);
    if (driverProof.error || documentProof.error || driverDocumentProof.error) {
      throw driverProof.error ?? documentProof.error ?? driverDocumentProof.error;
    }
    assert.equal(driverProof.data.approved_at === null, false);
    assert.equal(documentProof.data.length, 2);
    assert.ok(documentProof.data.every((row) => row.status === "reviewed"));
    assert.equal(driverDocumentProof.data.length, 2);
    assert.ok(driverDocumentProof.data.every((row) => row.status === "current"));
    for (const row of documentProof.data) {
      artifacts.documentIds.add(row.id);
      artifacts.storagePaths.add(row.storage_path);
    }
    for (const row of driverDocumentProof.data) {
      artifacts.driverDocumentIds.add(row.id);
    }

    const publicAfterApproval = await callJson({
      path: `/api/roster/${bearerToken}`,
    });
    assert.equal(publicAfterApproval.status, 200);
    const postApprovalDrivers = arrayValue(
      record(publicAfterApproval.body, "post-approval roster").drivers,
      "post-approval drivers"
    ).map((value) => record(value, "post-approval driver"));
    assert.equal(postApprovalDrivers.length, 1);
    assert.equal(postApprovalDrivers[0]?.id, driverId);
    assert.equal(typeof postApprovalDrivers[0]?.approvedAt, "string");

    assert.equal(
      (await service
        .from("clients")
        .select("driver_count")
        .eq("id", CLIENT_ID)
        .single()).data?.driver_count,
      EXPECTED_BILLING_DRIVER_COUNT
    );
    proof.review = {
      driverId,
      source: "client_portal",
      approvedAtSet: true,
      approvedBySet: true,
      documentsReviewed: 2,
      driverDocumentsCurrent: 2,
      publicLinkRetainsReviewedRow: true,
      stagedExcludedBeforeApproval: true,
      approvedIncludedAfterApproval: true,
      billingDriverCount: EXPECTED_BILLING_DRIVER_COUNT,
    };

    await pauseForBrowserReview({
      requestId: artifacts.requestId,
      driverId,
      stage: "after_approval",
    });
    proof.browserCheckpoint = {
      ...record(proof.browserCheckpoint, "browser checkpoint proof"),
      approvedSurfacesReviewedBeforeClose: true,
    };

    const closed = await callJson({
      path: `/api/clients/${CLIENT_ID}/driver-roster-request/${artifacts.requestId}/close`,
      method: "POST",
      cookie: staff.cookie,
    });
    assert.equal(closed.status, 200);
    assert.equal(
      record(record(closed.body, "close response").request, "closed request")
        .status,
      "fulfilled"
    );
    const closedTokenApi = await callJson({
      path: `/api/roster/${bearerToken}`,
    });
    assert.equal(closedTokenApi.status, 410);
    assert.equal(
      record(closedTokenApi.body, "closed token response").code,
      "ROSTER_REQUEST_CLOSED"
    );
    const portalAfterClose = await callText({
      path: "/portal/documents",
      cookie: portal.cookie,
    });
    assert.equal(portalAfterClose.status, 200);
    assert.equal(portalAfterClose.body.includes(ROSTER_TITLE), false);

    const checklistAfterCloseRoute = await callJson({
      path: `/api/clients/${CLIENT_ID}/checklist`,
      cookie: staff.cookie,
    });
    assert.equal(checklistAfterCloseRoute.status, 200);
    const checklistAfterClose = checklist(checklistAfterCloseRoute.body);
    assert.equal(
      checklistAfterClose.items.some(
        (item) => item.ruleKey === "compliance.roster_review"
      ),
      false
    );
    assert.equal(
      checklistAfterClose.items.some(
        (item) => item.ruleKey === "compliance.roster_empty"
      ),
      false
    );

    const activities = await service
      .from("activity_log")
      .select("id, action_type, entity_id, metadata")
      .eq("client_id", CLIENT_ID)
      .gte("created_at", runStartedAt)
      .in("entity_id", [artifacts.requestId, driverId])
      .in("action_type", [
        "client_driver_roster_requested",
        "client_driver_roster_submitted",
        "compliance_driver_approved",
        "client_driver_roster_request_closed",
      ])
      .order("created_at");
    if (activities.error) throw activities.error;
    const actionTypes = (activities.data ?? []).map((row) => row.action_type);
    for (const required of [
      "client_driver_roster_requested",
      "client_driver_roster_submitted",
      "compliance_driver_approved",
      "client_driver_roster_request_closed",
    ]) {
      assert.ok(actionTypes.includes(required), `Missing activity ${required}`);
    }
    for (const row of activities.data ?? []) {
      artifacts.activityIds.add(row.id);
      assert.equal(
        JSON.stringify(row.metadata).includes(bearerToken as string),
        false,
        "Bearer token entered activity metadata."
      );
    }
    const requestActivity = (activities.data ?? []).find(
      (row) => row.action_type === "client_driver_roster_requested"
    );
    const delivery = isRecord(requestActivity?.metadata)
      ? requestActivity.metadata.email_delivery
      : null;
    assert.equal(record(delivery, "request email activity").status, "dry_run");
    proof.close = {
      closeStatus: closed.status,
      closedTokenApiStatus: closedTokenApi.status,
      requestRemovedFromPortalDocuments: true,
      postCloseRosterRulesCleared: true,
      activityTypes: actionTypes,
      activityBearerTokenLeak: false,
    };
    proof.publicWizard = {
      pageStatus: publicPage.status,
      initialApiStatus: initialApi.status,
      invalidTokenApiStatus: invalidApi.status,
      injectedClientIdStatus: injectedClientId.status,
      createStatus: driverCreated.status,
      rejectedPublicPatchStatus: rejectedPublicPatch.status,
      resumeCount: 1,
      partialPatchPreservedStateAndClass: true,
      documentUploads: 2,
      removeStatus: removed.status,
      submitStatus: submitted.status,
      submitResponse: submitBody.response,
      genericPortalUploadGuardStatus: genericUpload.status,
    };
  } catch (error) {
    proofFailure = errorMessage(error, bearerToken);
  } finally {
    try {
      cleanupFailures.push(
        ...(await cleanupExactArtifacts(service, artifacts, runStartedAt))
      );
    } catch (error) {
      cleanupFailures.push(
        `cleanup execution: ${errorMessage(error, bearerToken)}`
      );
    }
    for (const session of [portal, staff]) {
      if (!session) continue;
      try {
        await session.revoke();
      } catch (error) {
        cleanupFailures.push(`session revocation: ${errorMessage(error, bearerToken)}`);
      }
    }
  }

  let finalState: Baseline | null = null;
  let finalFailure: string | null = null;
  try {
    finalState = await assertFinalState(service, baseline, artifacts);
  } catch (error) {
    finalFailure = errorMessage(error, bearerToken);
  }

  const passed =
    proofFailure === null && cleanupFailures.length === 0 && finalFailure === null;
  const cleanupVerified =
    cleanupFailures.length === 0 && finalFailure === null && finalState !== null;
  console.log(
    JSON.stringify(
      {
        passed,
        mode: "live_reversible",
        bearerTokenPrinted: false,
        baseUrl: BASE_URL,
        baseline: {
          drivers: baseline.drivers,
          openRosterRequests: baseline.openRosterRequests,
          totalRosterRequests: baseline.totalRosterRequests,
          billingDriverCount: baseline.client.driver_count,
          protectedCounts: baseline.protectedCounts,
        },
        proof,
        cleanup: {
          failures: cleanupFailures,
          requestRows: finalState?.totalRosterRequests ?? null,
          openRosterRequests: finalState?.openRosterRequests ?? null,
          drivers: finalState?.drivers ?? null,
          billingDriverCount: finalState?.client.driver_count ?? null,
          protectedCountsRestored:
            finalState !== null &&
            JSON.stringify(finalState.protectedCounts) ===
              JSON.stringify(baseline.protectedCounts),
          documentRows: cleanupVerified ? 0 : null,
          driverDocumentRows: cleanupVerified ? 0 : null,
          activityRows: cleanupVerified ? 0 : null,
          storageObjects: cleanupVerified ? 0 : null,
          sessionsRevoked: cleanupFailures.every(
            (failure) => !failure.startsWith("session revocation")
          ),
        },
        failure: proofFailure,
        finalFailure,
      },
      null,
      2
    )
  );
  if (!passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        passed: false,
        mode: RUN_LIVE ? "live_reversible" : "read_only",
        error: redact(
          error instanceof Error ? error.message : String(error),
          null
        ),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
