import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { findReportPlaceholders } from "../lib/reports/report-generation";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/+$/,
  ""
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const syntheticUserEmail = "safescore-phase11-acme@example.com";
const syntheticInviteEmail = `safescore-round5-${Date.now()}@example.com`;

type JsonObject = Record<string, unknown>;

function hashContent(value: string | null): string {
  return createHash("sha256").update(value ?? "<NULL>").digest("hex");
}

function locationPath(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location, baseUrl);
  return `${url.pathname}${url.search}`;
}

async function readJson(response: Response): Promise<JsonObject> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as JsonObject;
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}; received HTTP ${response.status}: ${raw.slice(0, 300)}`
    );
  }
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const syntheticProfileResult = await service
    .from("users")
    .select("id, email, role, client_id, full_name")
    .eq("email", syntheticUserEmail)
    .single();
  if (syntheticProfileResult.error || !syntheticProfileResult.data) {
    throw (
      syntheticProfileResult.error ??
      new Error("Synthetic verification profile was not found")
    );
  }
  const syntheticBaseline = syntheticProfileResult.data;
  assert.equal(syntheticBaseline.role, "client_user");

  const clientFields =
    "id, name, dot_number, tier, status, primary_contact, email, phone, service_agreement_accepted, fmcsa_authorized, updated_at";
  const clientBeforeResult = await service
    .from("clients")
    .select(clientFields)
    .eq("id", clientId)
    .single();
  if (clientBeforeResult.error || !clientBeforeResult.data) {
    throw clientBeforeResult.error ?? new Error("Nationwide was not found");
  }
  const clientBefore = clientBeforeResult.data;

  const latestSnapshotResult = await service
    .from("burden_snapshots")
    .select(
      "id, captured_at, total_points, violation_count, per_basic"
    )
    .eq("client_id", clientId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();
  if (latestSnapshotResult.error || !latestSnapshotResult.data) {
    throw (
      latestSnapshotResult.error ??
      new Error("Latest burden snapshot was not found")
    );
  }
  const latestSnapshot = latestSnapshotResult.data;
  const scoringWindowViolationCount = (
    latestSnapshot.per_basic as Array<{ violation_count?: number }>
  ).reduce(
    (total, basic) => total + (basic.violation_count ?? 0),
    0
  );
  const onFileViolationCount = latestSnapshot.violation_count;

  const reportsBeforeResult = await service
    .from("reports")
    .select("id, ai_content, final_content")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (reportsBeforeResult.error) throw reportsBeforeResult.error;
  const reportHashesBefore = new Map(
    (reportsBeforeResult.data ?? []).map((row) => [
      row.id,
      {
        ai: hashContent(row.ai_content),
        final: hashContent(row.final_content),
      },
    ])
  );

  let clientSession:
    | Awaited<ReturnType<typeof createDeployedClientSession>>
    | null = null;
  let staffSession:
    | Awaited<ReturnType<typeof createDeployedStaffSession>>
    | null = null;
  let recoveryAccessToken: string | null = null;
  let inviteId: string | null = null;
  let inviteRevoked = false;

  try {
    const linkResult = await service
      .from("users")
      .update({ client_id: clientId })
      .eq("id", syntheticBaseline.id)
      .eq("role", "client_user")
      .select("id, client_id")
      .single();
    if (linkResult.error || linkResult.data?.client_id !== clientId) {
      throw linkResult.error ?? new Error("Synthetic profile link failed");
    }

    clientSession = await createDeployedClientSession(
      baseUrl,
      syntheticUserEmail
    );
    staffSession = await createDeployedStaffSession(baseUrl);

    const clientConsole = await fetch(`${baseUrl}/console`, {
      headers: { cookie: clientSession.cookie },
      redirect: "manual",
    });
    assert.equal(clientConsole.status, 307);
    assert.equal(
      locationPath(clientConsole),
      "/access-mismatch?target=console"
    );
    const clientMismatch = await fetch(
      `${baseUrl}/access-mismatch?target=console`,
      { headers: { cookie: clientSession.cookie } }
    );
    const clientMismatchHtml = await clientMismatch.text();
    assert.equal(clientMismatch.status, 200);
    assert.match(
      clientMismatchHtml,
      /Signed in as a portal user[^<]*sign out to access the console/
    );

    const staffPortal = await fetch(`${baseUrl}/portal`, {
      headers: { cookie: staffSession.cookie },
      redirect: "manual",
    });
    assert.equal(staffPortal.status, 307);
    assert.equal(locationPath(staffPortal), "/access-mismatch?target=portal");
    const staffMismatch = await fetch(
      `${baseUrl}/access-mismatch?target=portal`,
      { headers: { cookie: staffSession.cookie } }
    );
    const staffMismatchHtml = await staffMismatch.text();
    assert.equal(staffMismatch.status, 200);
    assert.match(
      staffMismatchHtml,
      /Signed in as a staff user[^<]*sign out to access the client portal/
    );

    const onboardingPage = await fetch(`${baseUrl}/onboarding`, {
      headers: { cookie: clientSession.cookie },
      redirect: "manual",
    });
    assert.equal(onboardingPage.status, 307);
    assert.equal(locationPath(onboardingPage), "/portal");

    const blockedProfile = await fetch(
      `${baseUrl}/api/portal/onboarding-profile`,
      {
        method: "POST",
        headers: {
          cookie: clientSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ contactName: "ROUND5 MUST NOT SAVE" }),
      }
    );
    const blockedProfileBody = await readJson(blockedProfile);
    assert.equal(blockedProfile.status, 409);
    assert.equal(blockedProfileBody.code, "ONBOARDING_LOCKED");

    const blockedCredentials = await fetch(
      `${baseUrl}/api/portal/fmcsa-credentials`,
      {
        method: "POST",
        headers: {
          cookie: clientSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pin: "000000", authorized: true }),
      }
    );
    const blockedCredentialsBody = await readJson(blockedCredentials);
    assert.equal(blockedCredentials.status, 409);
    assert.equal(blockedCredentialsBody.code, "ONBOARDING_LOCKED");

    const blockedCheckout = await fetch(
      `${baseUrl}/api/billing/create-checkout-session`,
      {
        method: "POST",
        headers: {
          cookie: clientSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tier: "total_safety" }),
      }
    );
    const blockedCheckoutBody = await readJson(blockedCheckout);
    assert.equal(blockedCheckout.status, 409);
    assert.equal(blockedCheckoutBody.code, "ONBOARDING_LOCKED");

    const portalPage = await fetch(`${baseUrl}/portal`, {
      headers: { cookie: clientSession.cookie },
    });
    const portalHtml = await portalPage.text();
    assert.equal(portalPage.status, 200);
    const scopeMatch = portalHtml.match(
      /(\d+) violations in the 24-month scoring window \((\d+) on file\)\./
    );
    assert.ok(scopeMatch, "Portal violation-scope fact was not rendered");
    assert.equal(Number(scopeMatch[1]), scoringWindowViolationCount);
    assert.equal(Number(scopeMatch[2]), onFileViolationCount);

    const resetResponse = await fetch(
      `${baseUrl}/api/auth/password-reset`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: syntheticUserEmail }),
      }
    );
    const resetBody = await readJson(resetResponse);
    assert.equal(resetResponse.status, 200);
    assert.equal(resetBody.dryRun, true);
    assert.equal(resetBody.emailSent, false);
    assert.equal(resetBody.requiresStaffAssistance, true);
    assert.equal(resetBody.resetUrl, undefined);

    const staffResetResponse = await fetch(
      `${baseUrl}/api/clients/${clientId}/password-reset`,
      {
        method: "POST",
        headers: {
          cookie: staffSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: syntheticUserEmail }),
      }
    );
    const staffResetBody = await readJson(staffResetResponse);
    assert.equal(staffResetResponse.status, 200);
    assert.equal(staffResetBody.dryRun, true);
    assert.equal(staffResetBody.emailSent, false);
    assert.equal(typeof staffResetBody.resetUrl, "string");
    const resetUrl = new URL(String(staffResetBody.resetUrl));
    assert.equal(resetUrl.origin, new URL(baseUrl).origin);
    const tokenHash = resetUrl.searchParams.get("token_hash");
    assert.ok(tokenHash);

    const recoveryVerification = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (
      recoveryVerification.error ||
      !recoveryVerification.data.session
    ) {
      throw (
        recoveryVerification.error ??
        new Error("Recovery verification did not create a session")
      );
    }
    recoveryAccessToken =
      recoveryVerification.data.session.access_token;
    const storageKey =
      `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
    const recoveryEncoded =
      `base64-${stringToBase64URL(JSON.stringify(recoveryVerification.data.session))}`;
    const recoveryCookie = createChunks(storageKey, recoveryEncoded)
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
    const updatePasswordPage = await fetch(`${baseUrl}/update-password`, {
      headers: { cookie: recoveryCookie },
    });
    const updatePasswordHtml = await updatePasswordPage.text();
    assert.equal(updatePasswordPage.status, 200);
    assert.match(updatePasswordHtml, /Choose a new password/);

    const accountPage = await fetch(
      `${baseUrl}/console/clients/${clientId}/account`,
      { headers: { cookie: staffSession.cookie } }
    );
    const accountHtml = await accountPage.text();
    assert.equal(accountPage.status, 200);
    assert.match(accountHtml, /Portal access/);

    const accessBefore = await fetch(
      `${baseUrl}/api/clients/${clientId}/invite`,
      { headers: { cookie: staffSession.cookie } }
    );
    const accessBeforeBody = await readJson(accessBefore);
    assert.equal(accessBefore.status, 200);
    const linkedUsers = accessBeforeBody.portalUsers as Array<JsonObject>;
    assert.ok(
      linkedUsers.some(
        (row) =>
          row.email === "brandonbell+manjinder@goldenerainsurance.com" &&
          typeof row.lastSignInAt === "string"
      )
    );

    const inviteResponse = await fetch(
      `${baseUrl}/api/clients/${clientId}/invite`,
      {
        method: "POST",
        headers: {
          cookie: staffSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: syntheticInviteEmail }),
      }
    );
    const inviteBody = await readJson(inviteResponse);
    assert.equal(inviteResponse.status, 200);
    assert.equal(inviteBody.emailSent, false);
    assert.equal(inviteBody.emailStatus, "dry_run");
    assert.equal(typeof inviteBody.setupUrl, "string");
    inviteId = (inviteBody.invite as JsonObject).id as string;
    assert.ok(inviteId);

    const accessWithInvite = await fetch(
      `${baseUrl}/api/clients/${clientId}/invite`,
      { headers: { cookie: staffSession.cookie } }
    );
    const accessWithInviteBody = await readJson(accessWithInvite);
    const pendingInvites =
      accessWithInviteBody.pendingInvites as Array<JsonObject>;
    assert.ok(
      pendingInvites.some(
        (row) =>
          row.id === inviteId && row.email === syntheticInviteEmail
      )
    );

    const revokeResponse = await fetch(
      `${baseUrl}/api/clients/${clientId}/invite`,
      {
        method: "DELETE",
        headers: {
          cookie: staffSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ inviteId }),
      }
    );
    const revokeBody = await readJson(revokeResponse);
    assert.equal(revokeResponse.status, 200);
    assert.equal(revokeBody.revokedInviteId, inviteId);
    inviteRevoked = true;

    const revokedInviteResult = await service
      .from("client_invites")
      .select("id, client_id, email, used_at, expires_at")
      .eq("id", inviteId)
      .single();
    if (revokedInviteResult.error || !revokedInviteResult.data) {
      throw (
        revokedInviteResult.error ??
        new Error("Revoked invite audit row was not found")
      );
    }
    assert.equal(revokedInviteResult.data.client_id, clientId);
    assert.equal(revokedInviteResult.data.email, syntheticInviteEmail);
    assert.equal(revokedInviteResult.data.used_at, null);
    assert.ok(
      Date.parse(revokedInviteResult.data.expires_at) <= Date.now()
    );

    const reportResponse = await fetch(
      `${baseUrl}/api/reports/generate-text`,
      {
        method: "POST",
        headers: {
          cookie: staffSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientId, type: "monthly" }),
      }
    );
    const reportBody = await readJson(reportResponse);
    if (!reportResponse.ok) {
      throw new Error(
        `Report generation returned HTTP ${reportResponse.status}: ${String(reportBody.error)}`
      );
    }
    assert.equal(typeof reportBody.reportId, "string");
    assert.equal(typeof reportBody.content, "string");
    const reportId = String(reportBody.reportId);
    const savedReportResult = await service
      .from("reports")
      .select(
        "id, client_id, type, status, ai_content, final_content, created_at"
      )
      .eq("id", reportId)
      .single();
    if (savedReportResult.error || !savedReportResult.data) {
      throw (
        savedReportResult.error ??
        new Error("Generated report row was not found")
      );
    }
    const savedReport = savedReportResult.data;
    assert.equal(savedReport.client_id, clientId);
    assert.equal(savedReport.type, "monthly");
    assert.equal(savedReport.status, "draft");
    assert.ok(savedReport.ai_content);
    assert.equal(savedReport.ai_content, savedReport.final_content);
    assert.deepEqual(
      findReportPlaceholders(savedReport.final_content ?? ""),
      []
    );
    assert.match(
      savedReport.final_content ?? "",
      new RegExp(
        `${scoringWindowViolationCount} violations in the 24-month scoring window \\(${onFileViolationCount} on file\\)\\.`
      )
    );
    assert.match(savedReport.final_content ?? "", /crash preventability/i);
    assert.match(savedReport.final_content ?? "", /Under investigation:/);
    assert.match(savedReport.final_content ?? "", /Evidence request for/);
    assert.match(savedReport.final_content ?? "", /Operational priority:/);

    const completionLogResult = await service
      .from("activity_log")
      .select("metadata")
      .eq("action_type", "report_generated")
      .eq("entity_type", "reports")
      .eq("entity_id", reportId)
      .single();
    if (completionLogResult.error || !completionLogResult.data) {
      throw (
        completionLogResult.error ??
        new Error("Report completion log was not found")
      );
    }
    const completionMetadata =
      completionLogResult.data.metadata as JsonObject;
    const generationId = String(completionMetadata.generation_id);
    const attemptsResult = await service
      .from("activity_log")
      .select("description, metadata, created_at")
      .eq("action_type", "report_generation_attempt")
      .eq("entity_type", "report_generation")
      .eq("entity_id", generationId)
      .order("created_at", { ascending: true });
    if (attemptsResult.error) throw attemptsResult.error;
    const attemptLog = (attemptsResult.data ?? []).map((row) => ({
      description: row.description,
      createdAt: row.created_at,
      attempt: (row.metadata as JsonObject).attempt,
      status: (row.metadata as JsonObject).status,
      reason: (row.metadata as JsonObject).reason,
      validationIssues:
        (row.metadata as JsonObject).validation_issues,
    }));
    assert.equal(attemptLog[0]?.status, "started");
    assert.equal(attemptLog.at(-1)?.status, "succeeded");
    assert.equal(
      reportBody.generationAttempts,
      attemptLog.at(-1)?.attempt
    );

    const reportsAfterResult = await service
      .from("reports")
      .select("id, ai_content, final_content")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (reportsAfterResult.error) throw reportsAfterResult.error;
    for (const [existingId, existingHashes] of reportHashesBefore) {
      const current:
        | {
            id: string;
            ai_content: string | null;
            final_content: string | null;
          }
        | undefined = (reportsAfterResult.data ?? []).find(
        (row) => row.id === existingId
      );
      assert.ok(current, `Existing report ${existingId} disappeared`);
      assert.deepEqual(
        {
          ai: hashContent(current.ai_content),
          final: hashContent(current.final_content),
        },
        existingHashes,
        `Existing report ${existingId} content changed`
      );
    }

    const clientAfterResult = await service
      .from("clients")
      .select(clientFields)
      .eq("id", clientId)
      .single();
    if (clientAfterResult.error || !clientAfterResult.data) {
      throw (
        clientAfterResult.error ??
        new Error("Nationwide post-check row was not found")
      );
    }
    assert.deepEqual(clientAfterResult.data, clientBefore);

    console.log(
      JSON.stringify(
        {
          deployedRouteEvidence: {
            clientConsoleCollision: {
              status: clientConsole.status,
              location: locationPath(clientConsole),
              renderedMessage:
                "Signed in as a portal user — sign out to access the console.",
            },
            staffPortalCollision: {
              status: staffPortal.status,
              location: locationPath(staffPortal),
              renderedMessage:
                "Signed in as a staff user — sign out to access the client portal.",
            },
            onboardingGuard: {
              pageStatus: onboardingPage.status,
              pageLocation: locationPath(onboardingPage),
              profileWriteStatus: blockedProfile.status,
              credentialWriteStatus: blockedCredentials.status,
              checkoutStatus: blockedCheckout.status,
              nationwideRowUnchanged: true,
            },
            portalViolationScope: {
              inWindow: Number(scopeMatch[1]),
              onFile: Number(scopeMatch[2]),
              renderedFact: scopeMatch[0],
              latestSnapshot: {
                id: latestSnapshot.id,
                capturedAt: latestSnapshot.captured_at,
                totalPoints: latestSnapshot.total_points,
              },
            },
            passwordRecovery: {
              publicRequestStatus: resetResponse.status,
              publicResponseGeneric: true,
              requiresStaffAssistance:
                resetBody.requiresStaffAssistance,
              staffGenerationStatus: staffResetResponse.status,
              dryRun: staffResetBody.dryRun,
              emailSent: staffResetBody.emailSent,
              staffCopyableResetUrlReturned: true,
              recoveryTokenVerified: true,
              updatePasswordPageStatus: updatePasswordPage.status,
            },
            portalAccessCard: {
              accountPageStatus: accountPage.status,
              cardRendered: true,
              linkedUsers: linkedUsers.map((row) => ({
                id: row.id,
                email: row.email,
                lastSignInAt: row.lastSignInAt,
              })),
              syntheticInvite: {
                id: inviteId,
                email: syntheticInviteEmail,
                emailSent: inviteBody.emailSent,
                emailStatus: inviteBody.emailStatus,
                setupUrlReturned: true,
                pendingThenRevoked: true,
                auditRowRetained: true,
              },
            },
          },
          report: {
            id: reportId,
            createdAt: savedReport.created_at,
            status: savedReport.status,
            aiContentNonNull: savedReport.ai_content !== null,
            finalContentNonNull: savedReport.final_content !== null,
            contentsIdentical:
              savedReport.ai_content === savedReport.final_content,
            placeholderMatches: findReportPlaceholders(
              savedReport.final_content ?? ""
            ),
            generationAttempts: reportBody.generationAttempts,
            generationId,
            attemptLog,
            priorReportContentsUnchanged: true,
            finalContent: savedReport.final_content,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (inviteId && !inviteRevoked) {
      const { error } = await service
        .from("client_invites")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", inviteId)
        .eq("client_id", clientId);
      if (error) {
        console.error(
          `Synthetic invite cleanup failed for ${inviteId}: ${error.message}`
        );
      }
    }
    if (recoveryAccessToken) {
      const { error } = await service.auth.admin.signOut(
        recoveryAccessToken,
        "local"
      );
      if (error) {
        console.error(
          `Recovery-session cleanup failed: ${error.message}`
        );
      }
    }
    if (clientSession) {
      await clientSession.revoke();
    }
    if (staffSession) {
      await staffSession.revoke();
    }
    const restoreResult = await service
      .from("users")
      .update({
        client_id: syntheticBaseline.client_id,
        role: syntheticBaseline.role,
        full_name: syntheticBaseline.full_name,
      })
      .eq("id", syntheticBaseline.id)
      .select("id, client_id, role, full_name")
      .single();
    if (restoreResult.error) throw restoreResult.error;
    assert.deepEqual(restoreResult.data, {
      id: syntheticBaseline.id,
      client_id: syntheticBaseline.client_id,
      role: syntheticBaseline.role,
      full_name: syntheticBaseline.full_name,
    });
    console.log(
      JSON.stringify({
        syntheticCleanup: {
          userId: syntheticBaseline.id,
          clientIdRestored: restoreResult.data.client_id,
          roleRestored: restoreResult.data.role,
          fullNameRestored:
            restoreResult.data.full_name === syntheticBaseline.full_name,
          clientSessionRevoked: clientSession !== null,
          staffSessionRevoked: staffSession !== null,
          recoverySessionRevoked: recoveryAccessToken !== null,
          inviteRevoked: inviteId === null || inviteRevoked,
        },
      })
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
