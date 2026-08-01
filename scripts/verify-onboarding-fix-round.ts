import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type Session } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import Stripe from "stripe";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

type Synthetic = {
  clientId: string;
  email: string;
  authUserId: string;
  inviteId: string;
};

type LiveState = {
  version: 1;
  createdAt: string;
  assessment: Synthetic;
  recurring: Synthetic;
  checkoutSessionId: string;
  checkoutUrl: string;
};

type ResponseBody = Record<string, unknown> & {
  code?: string;
  email?: string;
  emailSent?: boolean;
  emailStatus?: string;
  primaryContact?: string | null;
  nextPath?: string;
  assignedTier?: string;
  tier?: string;
  changed?: boolean;
  status?: string;
  success?: boolean;
  url?: string;
  invite?: { id?: string };
  client?: { id?: string; tier?: string } | null;
};

const command = process.argv[2] ?? "help";
const confirmed = process.argv.includes("--run-live");
const baseUrl = (process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app")
  .replace(/\/+$/, "");
const statePath = resolve(process.cwd(), "tmp", "onboarding-fix-live-state.json");

function normalizedEnv(name: string) {
  return (process.env[name] ?? "")
    .trim()
    .replace(/(?:\\n)+$/g, "")
    .trim();
}

function requireLiveSafety() {
  if (!confirmed) {
    throw new Error(`${command} requires the explicit --run-live safety flag`);
  }
  assert.equal(
    normalizedEnv("EMAIL_DRY_RUN").toLowerCase(),
    "true",
    "EMAIL_DRY_RUN must be exactly true before creating an invite"
  );
  assert.match(
    normalizedEnv("STRIPE_SECRET_KEY"),
    /^sk_test_/,
    "The Stripe key must be TEST mode"
  );
}

const service = createClient(
  normalizedEnv("NEXT_PUBLIC_SUPABASE_URL"),
  normalizedEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const stripe = new Stripe(normalizedEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2026-02-25.clover",
});

function cookieFor(session: Session) {
  const projectRef = new URL(normalizedEnv("NEXT_PUBLIC_SUPABASE_URL"))
    .hostname.split(".")[0];
  const encoded = `base64-${stringToBase64URL(JSON.stringify(session))}`;
  return createChunks(`sb-${projectRef}-auth-token`, encoded)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

async function clientSession(email: string) {
  const generated = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${baseUrl}/auth/callback?next=/onboarding` },
  });
  if (generated.error || !generated.data.properties?.hashed_token) {
    throw generated.error ?? new Error("Could not generate a synthetic portal session");
  }
  const anon = createClient(
    normalizedEnv("NEXT_PUBLIC_SUPABASE_URL"),
    normalizedEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const verified = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: generated.data.properties.hashed_token,
  });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error("Synthetic portal session verification failed");
  }
  return {
    cookie: cookieFor(verified.data.session),
    accessToken: verified.data.session.access_token,
    revoke: async (scope: "local" | "global" = "local") => {
      const result = await service.auth.admin.signOut(
        verified.data.session!.access_token,
        scope
      );
      if (result.error) throw result.error;
    },
  };
}

async function json(response: Response, label: string) {
  const raw = await response.text();
  let body: ResponseBody = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${label}: expected JSON, received HTTP ${response.status}`);
  }
  return { response, body };
}

async function post(
  path: string,
  cookie: string,
  body: Record<string, unknown>,
  label: string
) {
  return json(await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), label);
}

async function setupSynthetic(input: {
  clientId: string;
  email: string;
  name: string;
  dot: string;
  staffCookie: string;
  verifyTierlessRefusal: boolean;
}) {
  const inserted = await service.from("clients").insert({
    id: input.clientId,
    name: input.name,
    dot_number: input.dot,
    email: input.email,
    primary_contact: "Pending Onboarding",
    status: "onboarding",
    tier: input.verifyTierlessRefusal ? null : "monitor",
  });
  if (inserted.error) throw inserted.error;

  if (input.verifyTierlessRefusal) {
    const refused = await post(
      `/api/clients/${input.clientId}/invite`,
      input.staffCookie,
      { email: input.email },
      "tierless invite"
    );
    assert.equal(refused.response.status, 409);
    assert.equal(refused.body.code, "CLIENT_TIER_REQUIRED");
    const absent = await service.from("client_invites")
      .select("id", { count: "exact", head: true })
      .eq("client_id", input.clientId);
    if (absent.error) throw absent.error;
    assert.equal(absent.count, 0);

    const assigned = await service.from("clients")
      .update({ tier: "monitor" })
      .eq("id", input.clientId);
    if (assigned.error) throw assigned.error;
  }

  const invited = await post(
    `/api/clients/${input.clientId}/invite`,
    input.staffCookie,
    { email: input.email },
    "tiered invite"
  );
  assert.equal(invited.response.status, 200);
  assert.equal(invited.body.emailStatus, "dry_run");
  assert.equal(invited.body.emailSent, false);
  assert.ok(invited.body.invite?.id);

  const invite = await service.from("client_invites")
    .select("id, token")
    .eq("id", invited.body.invite.id)
    .single();
  if (invite.error || !invite.data) throw invite.error ?? new Error("Invite row missing");

  const validation = await json(
    await fetch(`${baseUrl}/api/auth/setup?token=${encodeURIComponent(invite.data.token)}`),
    "invite validation"
  );
  assert.equal(validation.response.status, 200);
  assert.equal(validation.body.email, input.email);
  assert.equal(validation.body.primaryContact ?? "", "",
    "The Pending Onboarding seed must not leak into setup");

  const setup = await json(await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invite.data.token,
      password: `Synthetic-${Date.now()}-Only!`,
      fullName: "Synthetic Safety Contact",
    }),
  }), "account setup");
  assert.equal(setup.response.status, 200);
  assert.equal(setup.body.nextPath, "/onboarding");

  const profile = await service.from("users")
    .select("id, role, client_id, full_name")
    .eq("email", input.email)
    .single();
  if (profile.error || !profile.data) throw profile.error ?? new Error("Portal profile missing");
  assert.equal(profile.data.role, "client_user");
  assert.equal(profile.data.client_id, input.clientId);
  assert.equal(profile.data.full_name, "Synthetic Safety Contact");

  return {
    clientId: input.clientId,
    email: input.email,
    authUserId: profile.data.id,
    inviteId: invite.data.id,
  } satisfies Synthetic;
}

async function prepare() {
  requireLiveSafety();
  assert.equal(
    existsSync(statePath),
    false,
    `A verifier state file already exists at ${statePath}; finish or inspect that run before preparing another`
  );
  await mkdir(resolve(process.cwd(), "tmp"), { recursive: true });
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const assessmentId = randomUUID();
  const recurringId = randomUUID();
  const assessmentEmail = `safescore-onboarding-assessment-${stamp}@example.com`;
  const recurringEmail = `safescore-onboarding-recurring-${stamp}@example.com`;
  const assessmentDot = `TESTA-${stamp}`;
  const recurringDot = `TESTR-${stamp}`;
  const staff = await createDeployedStaffSession(baseUrl);
  let assessmentSession: Awaited<ReturnType<typeof clientSession>> | null = null;
  let recurringSession: Awaited<ReturnType<typeof clientSession>> | null = null;
  let state: LiveState | null = null;

  try {
    const assessment = await setupSynthetic({
      clientId: assessmentId,
      email: assessmentEmail,
      name: `TEST—Onboarding Assessment ${stamp}`,
      dot: assessmentDot,
      staffCookie: staff.cookie,
      verifyTierlessRefusal: true,
    });
    const recurring = await setupSynthetic({
      clientId: recurringId,
      email: recurringEmail,
      name: `TEST—Onboarding Recurring ${stamp}`,
      dot: recurringDot,
      staffCookie: staff.cookie,
      verifyTierlessRefusal: false,
    });

    assessmentSession = await clientSession(assessment.email);
    recurringSession = await clientSession(recurring.email);

    for (const candidate of [
      { synthetic: assessment, cookie: assessmentSession.cookie },
      { synthetic: recurring, cookie: recurringSession.cookie },
    ]) {
      const me = await json(await fetch(`${baseUrl}/api/portal/me`, {
        headers: { cookie: candidate.cookie },
      }), "assigned-tier profile");
      assert.equal(me.response.status, 200);
      assert.equal(me.body.client?.id, candidate.synthetic.clientId);
      assert.equal(me.body.client?.tier, "monitor");
    }

    const zero = await post(
      "/api/portal/onboarding-profile",
      assessmentSession.cookie,
      { driverCount: 0 },
      "zero driver count"
    );
    assert.equal(zero.response.status, 400);
    const afterZero = await service.from("clients")
      .select("driver_count")
      .eq("id", assessment.clientId)
      .single();
    if (afterZero.error) throw afterZero.error;
    assert.equal(afterZero.data.driver_count, null);

    const validAssessment = await post(
      "/api/portal/onboarding-profile",
      assessmentSession.cookie,
      {
        contactName: "Synthetic Safety Contact",
        contactTitle: "Safety Manager",
        contactPhone: "555-010-1001",
        contactEmail: assessment.email,
        vehicleTypes: ["Dry van"],
        operatingStates: ["CA"],
        operatingRadius: "regional",
        driverCount: 3,
        eldProvider: "Synthetic ELD",
        safetyContactName: "Synthetic Safety Contact",
        safetyContactEmail: assessment.email,
        citationDismissedLast24Months: true,
      },
      "assessment profile"
    );
    assert.equal(validAssessment.response.status, 200);

    const assessmentProfileRow = await service.from("clients")
      .select("tier, status, driver_count, citation_dismissed_last_24_months")
      .eq("id", assessment.clientId)
      .single();
    if (assessmentProfileRow.error) throw assessmentProfileRow.error;
    assert.deepEqual(assessmentProfileRow.data, {
      tier: "monitor",
      status: "onboarding",
      driver_count: 3,
      citation_dismissed_last_24_months: true,
    });
    const evidenceRequests = await service.from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", assessment.clientId)
      .eq("request_type", "evidence");
    if (evidenceRequests.error) throw evidenceRequests.error;
    assert.equal(evidenceRequests.count, 0,
      "Assessment persists the answer without creating an out-of-tier evidence request");

    const agreement = await post(
      "/api/portal/onboarding-profile",
      assessmentSession.cookie,
      { serviceAgreementAccepted: true },
      "assessment agreement"
    );
    assert.equal(agreement.response.status, 200);

    const changed = await json(await fetch(`${baseUrl}/api/portal/onboarding-tier`, {
      method: "PATCH",
      headers: { cookie: assessmentSession.cookie, "content-type": "application/json" },
      body: JSON.stringify({ tier: "assessment" }),
    }), "client tier change");
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.assignedTier, "monitor");
    assert.equal(changed.body.tier, "assessment");
    assert.equal(changed.body.changed, true);

    const activation = await post(
      "/api/portal/onboarding-activation",
      assessmentSession.cookie,
      {},
      "assessment activation"
    );
    assert.equal(activation.response.status, 200);
    assert.equal(activation.body.status, "awaiting_activation");
    assert.equal(activation.body.tier, "assessment");
    assert.equal(activation.body.nextPath, "/onboarding");

    const validRecurring = await post(
      "/api/portal/onboarding-profile",
      recurringSession.cookie,
      {
        contactName: "Synthetic Recurring Contact",
        contactTitle: "Safety Manager",
        contactPhone: "555-010-1002",
        contactEmail: recurring.email,
        vehicleTypes: ["Dry van"],
        operatingStates: ["CA"],
        operatingRadius: "regional",
        driverCount: 4,
        safetyContactName: "Synthetic Recurring Contact",
        safetyContactEmail: recurring.email,
        citationDismissedLast24Months: false,
      },
      "recurring profile"
    );
    assert.equal(validRecurring.response.status, 200);
    const recurringAgreement = await post(
      "/api/portal/onboarding-profile",
      recurringSession.cookie,
      { serviceAgreementAccepted: true },
      "recurring agreement"
    );
    assert.equal(recurringAgreement.response.status, 200);

    const checkout = await post(
      "/api/billing/create-checkout-session",
      recurringSession.cookie,
      { tier: "monitor" },
      "recurring checkout"
    );
    assert.equal(checkout.response.status, 200);
    if (typeof checkout.body.url !== "string") {
      throw new Error("Checkout response did not include a URL");
    }
    const checkoutUrl = checkout.body.url;
    assert.equal(new URL(checkoutUrl).hostname, "checkout.stripe.com");
    const sessions = await stripe.checkout.sessions.list({ limit: 20 });
    const checkoutSession = sessions.data.find(
      (candidate) => candidate.url === checkoutUrl &&
        candidate.metadata?.client_id === recurring.clientId
    );
    assert.ok(checkoutSession, "Created Stripe Checkout session was not found");
    assert.equal(checkoutSession.livemode, false);
    assert.equal(checkoutSession.mode, "subscription");
    assert.equal(checkoutSession.metadata?.tier, "monitor");

    state = {
      version: 1,
      createdAt: new Date().toISOString(),
      assessment,
      recurring,
      checkoutSessionId: checkoutSession.id,
      checkoutUrl,
    };
    await writeFile(statePath, JSON.stringify(state, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    console.log(JSON.stringify({
      prepared: true,
      statePath,
      assessmentClientId: assessment.clientId,
      recurringClientId: recurring.clientId,
      checkoutSessionId: checkoutSession.id,
      next: [
        "Use a cookie-authenticated browser session to verify the assessment awaiting-activation timeline.",
        "Open checkoutUrl from the state file and complete hosted Stripe TEST checkout with an approved test card.",
        "Run: npx tsx scripts/verify-onboarding-fix-round.ts finalize --run-live",
      ],
      noRealEmails: true,
      stripeLivemode: false,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      retainedSyntheticOnFailure: true,
      assessmentClientId: assessmentId,
      recurringClientId: recurringId,
      assessmentEmail,
      recurringEmail,
      reason: "SafeScore production is additive-only; synthetics are clearly TEST-labeled and were not deleted.",
    }));
    throw error;
  } finally {
    await Promise.allSettled([
      assessmentSession?.revoke(),
      recurringSession?.revoke(),
      staff.revoke(),
    ]);
  }
}

async function readState() {
  const parsed = JSON.parse(await readFile(statePath, "utf8")) as LiveState;
  assert.equal(parsed.version, 1);
  return parsed;
}

async function finalize() {
  requireLiveSafety();
  const state = await readState();
  const checkout = await stripe.checkout.sessions.retrieve(state.checkoutSessionId);
  assert.equal(checkout.livemode, false);
  assert.equal(checkout.payment_status, "paid",
    "Complete the hosted Stripe TEST checkout before finalize");
  assert.equal(checkout.metadata?.client_id, state.recurring.clientId);
  assert.equal(checkout.metadata?.tier, "monitor");

  const assessmentSession = await clientSession(state.assessment.email);
  const recurringSession = await clientSession(state.recurring.email);
  const staff = await createDeployedStaffSession(baseUrl);
  try {
    const sync = await post(
      "/api/billing/sync",
      recurringSession.cookie,
      { session_id: state.checkoutSessionId },
      "Stripe sync"
    );
    assert.equal(sync.response.status, 200);
    assert.equal(sync.body.success, true);
    assert.equal(sync.body.tier, "monitor");

    const [assessmentBefore, recurringAfter, subscription, tierActivity] = await Promise.all([
      service.from("clients")
        .select("id, tier, status, citation_dismissed_last_24_months")
        .eq("id", state.assessment.clientId).single(),
      service.from("clients")
        .select("id, tier, status, driver_count")
        .eq("id", state.recurring.clientId).single(),
      service.from("subscriptions")
        .select("client_id, tier, status, stripe_subscription_id, stripe_customer_id")
        .eq("client_id", state.recurring.clientId).single(),
      service.from("activity_log")
        .select("id, action_type, description, metadata")
        .eq("client_id", state.assessment.clientId)
        .eq("action_type", "tier_changed_by_client").single(),
    ]);
    for (const result of [assessmentBefore, recurringAfter, subscription, tierActivity]) {
      if (result.error) throw result.error;
    }
    assert.ok(assessmentBefore.data);
    assert.ok(recurringAfter.data);
    assert.ok(subscription.data);
    assert.ok(tierActivity.data);
    const assessmentBeforeRow = assessmentBefore.data;
    const recurringAfterRow = recurringAfter.data;
    const subscriptionRow = subscription.data;
    const tierActivityRow = tierActivity.data;
    assert.equal(assessmentBeforeRow.status, "awaiting_activation");
    assert.equal(assessmentBeforeRow.tier, "assessment");
    assert.equal(assessmentBeforeRow.citation_dismissed_last_24_months, true);
    assert.equal(recurringAfterRow.status, "active");
    assert.equal(recurringAfterRow.tier, "monitor");
    assert.equal(subscriptionRow.status, "active");
    assert.equal(subscriptionRow.tier, "monitor");
    assert.equal(subscriptionRow.stripe_subscription_id, checkout.subscription);
    assert.equal(subscriptionRow.stripe_customer_id, checkout.customer);
    assert.equal((tierActivityRow.metadata as Record<string, unknown>).assigned_tier, "monitor");
    assert.equal((tierActivityRow.metadata as Record<string, unknown>).selected_tier, "assessment");
    assert.equal((tierActivityRow.metadata as Record<string, unknown>).requires_staff_follow_up, true);

    const consolePage = await fetch(
      `${baseUrl}/console/clients/${state.assessment.clientId}`,
      { headers: { cookie: staff.cookie } }
    );
    const consoleHtml = await consolePage.text();
    const consoleText = consoleHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    assert.equal(consolePage.status, 200);
    assert.match(consoleText, /selected Assessment/i);
    assert.match(consoleText, /assigned Monitor/i);

    const waitingPage = await fetch(`${baseUrl}/onboarding`, {
      headers: { cookie: assessmentSession.cookie },
    });
    assert.equal(waitingPage.status, 200);

    const activated = await post(
      `/api/clients/${state.assessment.clientId}/activate`,
      staff.cookie,
      {},
      "staff assessment activation"
    );
    assert.equal(activated.response.status, 200);
    assert.equal(activated.body.status, "active");

    const assessmentAfter = await service.from("clients")
      .select("id, tier, status")
      .eq("id", state.assessment.clientId)
      .single();
    if (assessmentAfter.error) throw assessmentAfter.error;
    assert.equal(assessmentAfter.data.status, "active");
    assert.equal(assessmentAfter.data.tier, "assessment");

    const assessmentPortal = await fetch(`${baseUrl}/portal`, {
      headers: { cookie: assessmentSession.cookie },
      redirect: "manual",
    });
    const assessmentPortalHtml = await assessmentPortal.text();
    assert.equal(assessmentPortal.status, 200);
    assert.match(assessmentPortalHtml, /pending first analysis/i);

    const recurringPortal = await fetch(`${baseUrl}/portal`, {
      headers: { cookie: recurringSession.cookie },
      redirect: "manual",
    });
    assert.equal(recurringPortal.status, 200);

    const proof = {
      assessmentClientId: state.assessment.clientId,
      recurringClientId: state.recurring.clientId,
      tierlessInvite: { status: 409, code: "CLIENT_TIER_REQUIRED", rowCreated: false },
      assignedDefault: "monitor",
      tierChange: tierActivityRow,
      driverZeroRejected: true,
      citationAnswerPersisted: true,
      assessmentBeforeStaffActivation: assessmentBeforeRow,
      assessmentAfterStaffActivation: assessmentAfter.data,
      recurring: recurringAfterRow,
      subscription: {
        ...subscriptionRow,
        livemode: checkout.livemode,
        paymentStatus: checkout.payment_status,
      },
      consoleStaffFlagRendered: true,
      assessmentZeroSnapshotHomeRendered: true,
      noRealEmails: true,
    };

    await Promise.all([
      assessmentSession.revoke("global"),
      recurringSession.revoke("global"),
    ]);
    await unlink(statePath);
    console.log(JSON.stringify({
      proof,
      retention: {
        policy: "clearly labeled; no production rows deleted",
        localStateFileRemoved: true,
        authSessionsRevoked: true,
        stripeObjects: "TEST mode and retained for chat re-query",
      },
    }, null, 2));
  } finally {
    await Promise.allSettled([
      assessmentSession.revoke("global"),
      recurringSession.revoke("global"),
      staff.revoke(),
    ]);
  }
}

async function main() {
  if (command === "prepare") return prepare();
  if (command === "finalize") return finalize();
  console.log([
    "Safe production synthetic onboarding verifier (does nothing without --run-live).",
    "Prepare:  npx tsx scripts/verify-onboarding-fix-round.ts prepare --run-live",
    "Finalize: npx tsx scripts/verify-onboarding-fix-round.ts finalize --run-live",
    "Synthetics are retained with unmistakable TEST labels for chat re-query; no cleanup command is provided.",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
