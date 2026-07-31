import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { reconcileLaneBEvidenceLoopForClient } from "../lib/evidence-loop/server";
import { createDeployedClientSession } from "./lib/deployed-client-session";

loadEnvConfig(process.cwd());

const BASE_URL = (
  process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app"
).replace(/\/+$/, "");
const NATIONWIDE_ID = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const TARGET_VIOLATION_ID = "164153b8-3a1a-49c8-93d6-854148bee0c2";
const CANCELLED_NEGATED_SIGNAL_REQUEST_ID = "dbeede2c-a148-44c8-924a-d75910eef0b0";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function visibleText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ");
}

async function main() {
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  // The standing agency rule forbids a live send. This local proof overrides
  // only this process and captures the dry-run signal without printing the
  // linked portal user's email address.
  process.env.EMAIL_DRY_RUN = "true";
  const dryRunEvents: Array<{
    mode: string | null;
    trigger: string | null;
    template: string | null;
  }> = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    if (args[0] !== "EMAIL_DRY_RUN") {
      originalLog(...args);
      return;
    }
    try {
      const parsed = JSON.parse(String(args[1])) as Record<string, unknown>;
      dryRunEvents.push({
        mode: typeof parsed.mode === "string" ? parsed.mode : null,
        trigger: typeof parsed.trigger === "string" ? parsed.trigger : null,
        template: typeof parsed.template === "string" ? parsed.template : null,
      });
    } catch {
      dryRunEvents.push({ mode: null, trigger: null, template: null });
    }
  };

  const service = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  let first: Awaited<ReturnType<typeof reconcileLaneBEvidenceLoopForClient>>;
  let second: Awaited<ReturnType<typeof reconcileLaneBEvidenceLoopForClient>>;
  try {
    first = await reconcileLaneBEvidenceLoopForClient(service, {
      clientId: NATIONWIDE_ID,
      trigger: "first_use",
    });
    second = await reconcileLaneBEvidenceLoopForClient(service, {
      clientId: NATIONWIDE_ID,
      trigger: "first_use",
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(first.errors, [], `First reconciliation failed: ${first.errors.join(" | ")}`);
  assert.deepEqual(second.errors, [], `Second reconciliation failed: ${second.errors.join(" | ")}`);
  assert.equal(second.createdRequestIds.length, 0, "Second reconciliation created duplicate evidence requests");
  assert.equal(second.intakeQuestionCreated, false, "Second reconciliation created a duplicate intake question");
  assert.ok(
    dryRunEvents.every((event) => event.mode === "dry-run"),
    "At least one notification did not remain in dry-run mode"
  );

  const [targetResult, intakeResult, duplicateResult, userResult] = await Promise.all([
    service
      .from("client_requests")
      .select(
        "id, client_id, violation_id, request_type, evidence_class, evidence_status, status, title, description, why_copy, potential_points, requested_items, status_copy, case_type, case_id, created_at"
      )
      .eq("client_id", NATIONWIDE_ID)
      .eq("violation_id", TARGET_VIOLATION_ID)
      .eq("evidence_class", "citation-dismissed")
      .single(),
    service
      .from("client_requests")
      .select("id, request_type, evidence_class, evidence_status, status, title, status_copy")
      .eq("client_id", NATIONWIDE_ID)
      .eq("request_type", "question")
      .eq("evidence_class", "citation-dismissed")
      .single(),
    service
      .from("client_requests")
      .select("dedupe_key")
      .eq("client_id", NATIONWIDE_ID)
      .in("request_type", ["evidence", "question"]),
    service
      .from("users")
      .select("email")
      .eq("client_id", NATIONWIDE_ID)
      .eq("role", "client_user")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const [label, result] of Object.entries({
    target: targetResult,
    intake: intakeResult,
    duplicate: duplicateResult,
    user: userResult,
  })) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  const target = targetResult.data;
  assert(target, "The DA251770 violation request was not created");
  assert.equal(target.potential_points, 18);
  assert.match(target.title, /DA251770/);
  assert.match(target.why_copy ?? "", /remove 18 points/i);
  assert.match(JSON.stringify(target.requested_items), /certified-court-disposition/);
  assert(intakeResult.data, "The existing-client intake question was not created");
  assert(userResult.data?.email, "Nationwide has no linked client portal user");

  const dedupeCounts = new Map<string, number>();
  for (const row of duplicateResult.data ?? []) {
    dedupeCounts.set(row.dedupe_key, (dedupeCounts.get(row.dedupe_key) ?? 0) + 1);
  }
  const duplicateKeys = [...dedupeCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  assert.deepEqual(duplicateKeys, [], "Duplicate Lane B request keys exist");

  const activityResult = await service
    .from("activity_log")
    .select("id, action_type, entity_type, entity_id, description, metadata, created_at")
    .eq("client_id", NATIONWIDE_ID)
    .eq("entity_type", "client_requests")
    .eq("entity_id", target.id)
    .order("created_at", { ascending: true });
  if (activityResult.error) throw new Error(`activity: ${activityResult.error.message}`);
  const targetCreation = (activityResult.data ?? []).find(
    (row) => row.action_type === "lane_b_evidence_requested"
  );
  assert(targetCreation, "The target request has no creation activity");
  const delivery = (targetCreation.metadata as Record<string, unknown> | null)
    ?.email_delivery as Record<string, unknown> | undefined;
  assert.equal(delivery?.status, "dry_run");
  assert.equal(delivery?.dry_run, true);

  const session = await createDeployedClientSession(BASE_URL, userResult.data.email);
  let sessionRevoked = false;
  let portalProof: {
    apiStatus: number;
    pageStatus: number;
    targetVisibleInApi: true;
    cancelledNegatedSignalHidden: true;
    renderedMarkers: string[];
  } | null = null;
  try {
    const [apiResponse, pageResponse] = await Promise.all([
      fetch(`${BASE_URL}/api/portal/requests`, {
        headers: { cookie: session.cookie },
      }),
      fetch(`${BASE_URL}/portal/documents`, {
        headers: { cookie: session.cookie },
        redirect: "follow",
      }),
    ]);
    const apiBody = (await apiResponse.json()) as {
      error?: string;
      requests?: Array<Record<string, unknown>>;
    };
    const pageText = visibleText(await pageResponse.text());
    assert.equal(apiResponse.status, 200, apiBody.error ?? "Portal requests API failed");
    assert.equal(pageResponse.status, 200, "Portal Documents page failed");
    const apiTarget = (apiBody.requests ?? []).find((row) => row.id === target.id);
    assert(apiTarget, "Target request is missing from the authenticated portal API");
    assert(
      !(apiBody.requests ?? []).some(
        (row) => row.id === CANCELLED_NEGATED_SIGNAL_REQUEST_ID
      ),
      "Portal requests API still returns the cancelled negated-signal request"
    );
    for (const marker of [
      "DA251770",
      "Certified court disposition",
      "This could remove 18 points",
      "Has any driver fought and beaten a roadside ticket in the last 24 months?",
    ]) {
      assert(pageText.includes(marker), `Portal Documents is missing: ${marker}`);
    }
    assert(
      !pageText.includes("Records needed to prove a report error"),
      "Portal Documents still renders the cancelled negated-signal request"
    );
    portalProof = {
      apiStatus: apiResponse.status,
      pageStatus: pageResponse.status,
      targetVisibleInApi: true,
      cancelledNegatedSignalHidden: true,
      renderedMarkers: [
        "DA251770",
        "Certified court disposition",
        "This could remove 18 points",
        "Has any driver fought and beaten a roadside ticket in the last 24 months?",
      ],
    };
  } finally {
    await session.revoke();
    sessionRevoked = true;
  }
  assert(sessionRevoked);
  assert(portalProof);

  originalLog(
    JSON.stringify(
      {
        passed: true,
        firstRun: {
          reviewedViolations: first.reviewedViolations,
          evidenceRequestsCreated: first.createdRequestIds.length,
          intakeQuestionCreated: first.intakeQuestionCreated,
        },
        secondRun: {
          evidenceRequestsCreated: second.createdRequestIds.length,
          existingEvidenceRequests: second.existingRequestIds.length,
          intakeQuestionCreated: second.intakeQuestionCreated,
        },
        targetRequest: target,
        intakeQuestion: intakeResult.data,
        targetActivity: targetCreation,
        dryRunNotifications: {
          newCountThisRun: dryRunEvents.length,
          newEventsThisRun: dryRunEvents,
          targetPersistedStatus: delivery?.status,
          recipientsPrinted: false,
        },
        idempotency: { duplicateKeys },
        portal: portalProof,
        sessionRevokedAfterVerification: true,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
