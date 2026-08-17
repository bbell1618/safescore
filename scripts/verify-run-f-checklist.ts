import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ChecklistItem,
  OperatorManualItem,
} from "../lib/operator/checklist-types";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/+$/,
  ""
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const exerciseAuthorizedWrites = process.argv.includes(
  "--exercise-authorized-writes"
);
const exerciseDraftSendGuard = process.argv.includes(
  "--exercise-draft-send-guard"
);
const pauseBeforeCleanup = process.argv.includes("--pause-before-cleanup");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const zeroUuid = "00000000-0000-4000-8000-000000000000";

type JsonRecord = Record<string, unknown>;
type RouteResult = {
  name: string;
  method: string;
  path: string;
  status: number;
  body: unknown;
};
type ChecklistPayload = {
  items: ChecklistItem[];
  manualItems: OperatorManualItem[];
};
type TodayItem = ChecklistItem & { clientId: string; clientName: string };
type TodayPayload = { items: TodayItem[]; gates: ChecklistItem[] };
type AlertRow = {
  id: string;
  client_id: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
};
type AckRow = {
  id: string;
  client_id: string;
  rule_key: string;
  context_key: string;
  action: string;
  snoozed_until: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asChecklistPayload(value: unknown): ChecklistPayload {
  assert.ok(isRecord(value), "Checklist response was not an object");
  assert.ok(Array.isArray(value.items), "Checklist response omitted items");
  assert.ok(
    Array.isArray(value.manualItems),
    "Checklist response omitted manualItems"
  );
  return value as ChecklistPayload;
}

function asTodayPayload(value: unknown): TodayPayload {
  assert.ok(isRecord(value), "Today response was not an object");
  assert.ok(Array.isArray(value.items), "Today response omitted items");
  assert.ok(Array.isArray(value.gates), "Today response omitted gates");
  return value as TodayPayload;
}

async function responseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { nonJsonBody: raw.slice(0, 1_000) };
  }
}

async function callRoute(params: {
  name: string;
  path: string;
  method?: string;
  cookie?: string;
  body?: unknown;
}): Promise<RouteResult> {
  const method = params.method ?? "GET";
  const response = await fetch(`${baseUrl}${params.path}`, {
    method,
    headers: {
      ...(params.cookie ? { cookie: params.cookie } : {}),
      ...(params.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(params.body !== undefined
      ? { body: JSON.stringify(params.body) }
      : {}),
    redirect: "manual",
  });
  return {
    name: params.name,
    method,
    path: params.path,
    status: response.status,
    body: await responseBody(response),
  };
}

function assertChecklistItems(items: ChecklistItem[], label: string) {
  const ids = new Set<string>();
  for (const item of items) {
    assert.equal(typeof item.id, "string", `${label} item omitted id`);
    assert.equal(typeof item.ruleKey, "string", `${label} item omitted ruleKey`);
    assert.equal(
      typeof item.contextKey,
      "string",
      `${label} item omitted contextKey`
    );
    assert.ok(!ids.has(item.id), `${label} contained duplicate id ${item.id}`);
    ids.add(item.id);
    assert.ok(
      ["needs_you", "waiting_client", "waiting_gate"].includes(item.state),
      `${label} item ${item.id} had invalid state ${item.state}`
    );
    assert.ok([1, 2, 3].includes(item.priority));
    assert.ok(item.title.trim());
    assert.ok(item.why.trim());
    assert.ok(item.instructions.length > 0);
  }
}

async function authMatrix(
  portalCookie: string,
  alertId: string,
  draftReportId: string
): Promise<{ unauthenticated: RouteResult[]; portalUser: RouteResult[] }> {
  const routes = [
    {
      name: "client checklist",
      path: `/api/clients/${clientId}/checklist`,
      method: "GET",
    },
    { name: "operator Today", path: "/api/operator/today", method: "GET" },
    {
      name: "checklist acknowledgement",
      path: `/api/clients/${clientId}/checklist/ack`,
      method: "POST",
      body: {
        ruleKey: "service.quarterly_review",
        contextKey: "auth-matrix-only",
        action: "done",
      },
    },
    {
      name: "manual item create",
      path: `/api/clients/${clientId}/checklist/manual`,
      method: "POST",
      body: { title: "Auth matrix only" },
    },
    {
      name: "manual item update",
      path: `/api/clients/${clientId}/checklist/manual/${zeroUuid}`,
      method: "PATCH",
      body: { status: "done" },
    },
    {
      name: "monitoring alert acknowledgement",
      path: `/api/monitoring/alerts/${alertId}` + "/acknowledge",
      method: "POST",
    },
    {
      name: "report send",
      path: `/api/reports/${draftReportId}/send`,
      method: "POST",
    },
  ];
  const unauthenticated: RouteResult[] = [];
  const portalUser: RouteResult[] = [];
  for (const route of routes) {
    const unauth = await callRoute(route);
    assert.equal(
      unauth.status,
      401,
      `${route.name} did not reject an unauthenticated request`
    );
    unauthenticated.push(unauth);

    const portal = await callRoute({ ...route, cookie: portalCookie });
    assert.equal(
      portal.status,
      403,
      `${route.name} did not reject a portal user`
    );
    portalUser.push(portal);
  }
  return { unauthenticated, portalUser };
}

async function strictSchemaProofs(
  staffCookie: string
): Promise<RouteResult[]> {
  const proofs = [
    await callRoute({
      name: "strict checklist acknowledgement body",
      path: `/api/clients/${clientId}/checklist/ack`,
      method: "POST",
      cookie: staffCookie,
      body: {
        ruleKey: "service.quarterly_review",
        contextKey: "2026-Q3",
        action: "done",
        unexpected: true,
      },
    }),
    await callRoute({
      name: "strict manual create body",
      path: `/api/clients/${clientId}/checklist/manual`,
      method: "POST",
      cookie: staffCookie,
      body: { title: "Must not persist", unexpected: true },
    }),
    await callRoute({
      name: "single manual update action",
      path: `/api/clients/${clientId}/checklist/manual/${zeroUuid}`,
      method: "PATCH",
      cookie: staffCookie,
      body: { status: "done", deleted: true },
    }),
    await callRoute({
      name: "alert UUID validation",
      path: "/api/monitoring/alerts/not-a-uuid/acknowledge",
      method: "POST",
      cookie: staffCookie,
    }),
  ];
  for (const proof of proofs) {
    assert.equal(proof.status, 400, `${proof.name} did not fail validation`);
  }
  return proofs;
}

async function waitForCleanup() {
  if (!pauseBeforeCleanup) {
    throw new Error(
      "Authorized writes require --pause-before-cleanup so exact SQL cleanup can run before verification continues."
    );
  }
  if (!process.stdin.isTTY) {
    throw new Error("Cleanup pause requires an interactive TTY.");
  }
  console.log(
    "PAUSED_FOR_EXACT_SQL_CLEANUP: run only the printed ID-scoped statements, then press Enter."
  );
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function maybeSingle<T>(
  service: SupabaseClient,
  table: string,
  id: string
): Promise<T | null> {
  const result = await service.from(table).select("*").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  return (result.data as T | null) ?? null;
}

async function main() {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (exerciseAuthorizedWrites && !pauseBeforeCleanup) {
    throw new Error(
      "Refusing authorized production writes without --pause-before-cleanup."
    );
  }
  if (exerciseDraftSendGuard && !exerciseAuthorizedWrites) {
    throw new Error(
      "--exercise-draft-send-guard requires --exercise-authorized-writes."
    );
  }
  if (
    exerciseDraftSendGuard &&
    process.env.EMAIL_DRY_RUN?.trim().toLowerCase() === "false"
  ) {
    throw new Error(
      "Refusing the draft-send guard proof while the local production environment says email delivery is live."
    );
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const portalUserResult = await service
    .from("users")
    .select("id, email")
    .eq("client_id", clientId)
    .eq("role", "client_user")
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (portalUserResult.error || !portalUserResult.data?.email) {
    throw (
      portalUserResult.error ??
      new Error("Nationwide has no existing portal user with an email")
    );
  }

  const alertResult = await service
    .from("alerts")
    .select(
      "id, client_id, acknowledged_at, acknowledged_by, created_at"
    )
    .eq("client_id", clientId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (alertResult.error || !alertResult.data) {
    throw alertResult.error ?? new Error("Nationwide has no unacknowledged alert");
  }
  const alertBefore = alertResult.data as AlertRow;

  const draftResult = await service
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (draftResult.error || !draftResult.data) {
    throw draftResult.error ?? new Error("Nationwide has no draft report");
  }
  const draftBefore = draftResult.data as JsonRecord;
  const draftReportId = String(draftBefore.id ?? "");
  assert.match(draftReportId, uuidPattern);

  const staff = await createDeployedStaffSession(baseUrl);
  const portal = await createDeployedClientSession(
    baseUrl,
    portalUserResult.data.email
  );

  let alertAfter: AlertRow | null = null;
  let createdAck: AckRow | null = null;
  let cleanupVerified = !exerciseAuthorizedWrites;
  try {
    const auth = await authMatrix(portal.cookie, alertBefore.id, draftReportId);
    const strictSchemas = await strictSchemaProofs(staff.cookie);

    const checklistRoute = await callRoute({
      name: "Nationwide checklist",
      path: `/api/clients/${clientId}/checklist`,
      cookie: staff.cookie,
    });
    assert.equal(checklistRoute.status, 200);
    const checklist = asChecklistPayload(checklistRoute.body);
    assertChecklistItems(checklist.items, "Nationwide checklist");

    const todayRoute = await callRoute({
      name: "operator Today",
      path: "/api/operator/today",
      cookie: staff.cookie,
    });
    assert.equal(todayRoute.status, 200);
    const today = asTodayPayload(todayRoute.body);
    assertChecklistItems(today.items, "Today needs-you");
    assertChecklistItems(today.gates, "Today gates");
    assert.ok(
      today.items.every((item) => item.state === "needs_you"),
      "Today returned a non-needs-you client item"
    );

    let draftSendProof: RouteResult | null = null;
    if (exerciseDraftSendGuard) {
      draftSendProof = await callRoute({
        name: "draft report send guard",
        path: `/api/reports/${draftReportId}/send`,
        method: "POST",
        cookie: staff.cookie,
      });
      assert.equal(
        draftSendProof.status,
        409,
        "Draft report send was not rejected before mutation"
      );
      const draftAfterResult = await service
        .from("reports")
        .select("*")
        .eq("id", draftReportId)
        .single();
      if (draftAfterResult.error) throw draftAfterResult.error;
      assert.deepEqual(
        draftAfterResult.data,
        draftBefore,
        "Draft-send proof changed the protected report row"
      );
    }

    if (!exerciseAuthorizedWrites) {
      console.log(
        JSON.stringify(
          {
            passed: true,
            mode: "read-only",
            target: { baseUrl, clientId },
            existingPortalUserId: portalUserResult.data.id,
            auth,
            strictSchemas,
            nationwideChecklist: checklist,
            today,
            authorizedWriteProofs:
              "NOT RUN — rerun with --exercise-authorized-writes --exercise-draft-send-guard --pause-before-cleanup after confirming the exact READY deployment.",
          },
          null,
          2
        )
      );
      return;
    }

    const quarterly = checklist.items.find(
      (item) => item.ruleKey === "service.quarterly_review"
    );
    assert.ok(
      quarterly,
      "Nationwide quarterly review item is not active; refusing to create a test acknowledgement"
    );
    assert.equal(quarterly.canMarkDone, true);

    const alertAckRoute = await callRoute({
      name: "authorized alert acknowledgement",
      path: `/api/monitoring/alerts/${alertBefore.id}/acknowledge`,
      method: "POST",
      cookie: staff.cookie,
    });
    assert.equal(alertAckRoute.status, 200);
    alertAfter = await maybeSingle<AlertRow>(service, "alerts", alertBefore.id);
    assert.ok(alertAfter?.acknowledged_at);
    assert.ok(alertAfter.acknowledged_by);

    const quarterAckRoute = await callRoute({
      name: "authorized quarterly done acknowledgement",
      path: `/api/clients/${clientId}/checklist/ack`,
      method: "POST",
      cookie: staff.cookie,
      body: {
        ruleKey: quarterly.ruleKey,
        contextKey: quarterly.contextKey,
        action: "done",
        note: "Run F verification; delete immediately after proof.",
      },
    });
    assert.equal(quarterAckRoute.status, 201);
    assert.ok(isRecord(quarterAckRoute.body));
    assert.ok(isRecord(quarterAckRoute.body.acknowledgement));
    const ackId = String(quarterAckRoute.body.acknowledgement.id ?? "");
    assert.match(ackId, uuidPattern);
    createdAck = await maybeSingle<AckRow>(service, "operator_item_acks", ackId);
    assert.ok(createdAck);
    assert.equal(createdAck.client_id, clientId);
    assert.equal(createdAck.rule_key, quarterly.ruleKey);
    assert.equal(createdAck.context_key, quarterly.contextKey);
    assert.equal(createdAck.action, "done");

    const suppressedChecklistRoute = await callRoute({
      name: "quarterly acknowledgement suppression",
      path: `/api/clients/${clientId}/checklist`,
      cookie: staff.cookie,
    });
    assert.equal(suppressedChecklistRoute.status, 200);
    const suppressedChecklist = asChecklistPayload(suppressedChecklistRoute.body);
    assert.ok(
      !suppressedChecklist.items.some(
        (item) =>
          item.ruleKey === quarterly.ruleKey &&
          item.contextKey === quarterly.contextKey
      ),
      "Quarterly item remained after its exact done acknowledgement"
    );

    console.log(
      JSON.stringify(
        {
          readyForExactSqlCleanup: true,
          alertBefore,
          alertAfter,
          quarterlyItem: quarterly,
          createdAcknowledgement: createdAck,
          cleanupSql: [
            `update public.alerts set acknowledged_at = null, acknowledged_by = null where id = '${alertBefore.id}' and client_id = '${clientId}';`,
            `delete from public.operator_item_acks where id = '${createdAck.id}' and client_id = '${clientId}' and rule_key = '${quarterly.ruleKey}' and context_key = '${quarterly.contextKey}' and action = 'done';`,
          ],
        },
        null,
        2
      )
    );

    await waitForCleanup();

    const alertRestored = await maybeSingle<AlertRow>(
      service,
      "alerts",
      alertBefore.id
    );
    assert.ok(alertRestored);
    assert.equal(alertRestored.acknowledged_at, alertBefore.acknowledged_at);
    assert.equal(alertRestored.acknowledged_by, alertBefore.acknowledged_by);
    const ackRemoved = await maybeSingle<AckRow>(
      service,
      "operator_item_acks",
      createdAck.id
    );
    assert.equal(ackRemoved, null);
    cleanupVerified = true;

    const restoredChecklistRoute = await callRoute({
      name: "quarterly item revival after cleanup",
      path: `/api/clients/${clientId}/checklist`,
      cookie: staff.cookie,
    });
    assert.equal(restoredChecklistRoute.status, 200);
    const restoredChecklist = asChecklistPayload(restoredChecklistRoute.body);
    assert.ok(
      restoredChecklist.items.some(
        (item) =>
          item.ruleKey === quarterly.ruleKey &&
          item.contextKey === quarterly.contextKey
      ),
      "Quarterly item did not revive after deleting the exact test acknowledgement"
    );

    console.log(
      JSON.stringify(
        {
          passed: true,
          mode: "authorized round-trip",
          target: { baseUrl, clientId },
          existingPortalUserId: portalUserResult.data.id,
          auth,
          strictSchemas,
          nationwideChecklist: checklist,
          today,
          draftSendProof,
          alertRoundTrip: {
            before: alertBefore,
            acknowledged: alertAfter,
            restored: alertRestored,
          },
          quarterlyRoundTrip: {
            item: quarterly,
            acknowledgement: createdAck,
            suppressed: true,
            deleted: true,
            revived: true,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (!cleanupVerified) {
      // Emergency ID-scoped rollback only. The successful proof path pauses for
      // the required SQL cleanup and never reaches this branch.
      if (alertAfter) {
        const current = await maybeSingle<AlertRow>(service, "alerts", alertBefore.id);
        if (
          current?.acknowledged_at === alertAfter.acknowledged_at &&
          current.acknowledged_by === alertAfter.acknowledged_by
        ) {
          const rollback = await service
            .from("alerts")
            .update({
              acknowledged_at: alertBefore.acknowledged_at,
              acknowledged_by: alertBefore.acknowledged_by,
            })
            .eq("id", alertBefore.id)
            .eq("client_id", clientId)
            .eq("acknowledged_at", alertAfter.acknowledged_at!);
          if (rollback.error) throw rollback.error;
        }
      }
      if (createdAck) {
        const rollback = await service
          .from("operator_item_acks")
          .delete()
          .eq("id", createdAck.id)
          .eq("client_id", clientId)
          .eq("rule_key", createdAck.rule_key)
          .eq("context_key", createdAck.context_key)
          .eq("action", "done");
        if (rollback.error) throw rollback.error;
      }
      console.error(
        "The verifier used its emergency exact-ID rollback because SQL cleanup was not verified."
      );
    }
    await Promise.all([staff.revoke(), portal.revoke()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
