import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app").replace(/\/$/, "");
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const syntheticClientEmail = "safescore-phase11-acme@example.com";
const skipCron = process.env.SKIP_CRON === "true";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fetchPage(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
    redirect: "follow",
  });
  return { status: response.status, body: await response.text() };
}

async function main() {
  const { data: verificationUser, error: userError } = await service
    .from("users")
    .select("id, client_id, role")
    .eq("email", syntheticClientEmail)
    .single();
  if (userError || !verificationUser) {
    throw userError ?? new Error("Synthetic verification user is missing");
  }
  if (verificationUser.role !== "client_user" || verificationUser.client_id !== null) {
    throw new Error("Synthetic verification user is not in its expected unlinked baseline state");
  }

  let linked = false;
  let staff: Awaited<ReturnType<typeof createDeployedStaffSession>> | null = null;
  let client: Awaited<ReturnType<typeof createDeployedClientSession>> | null = null;

  try {
    const { data: linkedUser, error: linkError } = await service
      .from("users")
      .update({ client_id: nationwideId })
      .eq("id", verificationUser.id)
      .is("client_id", null)
      .select("id")
      .single();
    if (linkError || !linkedUser) {
      throw linkError ?? new Error("Could not establish the temporary portal verification link");
    }
    linked = true;

    [staff, client] = await Promise.all([
      createDeployedStaffSession(baseUrl),
      createDeployedClientSession(baseUrl, syntheticClientEmail),
    ]);

    const [consolePage, portalPage, evidencePage, unauthenticatedCron] = await Promise.all([
      fetchPage(`/console/clients/${nationwideId}`, staff.cookie),
      fetchPage("/portal", client.cookie),
      fetchPage("/evidence/not-a-valid-token"),
      fetch(`${baseUrl}/api/cron/monitoring-refresh`),
    ]);

    const unauthenticatedCronBody = await unauthenticatedCron.json().catch(() => null);
    let authenticatedCron:
      | { status: number; body: unknown }
      | { skipped: true };
    if (skipCron) {
      authenticatedCron = { skipped: true };
    } else {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret) throw new Error("CRON_SECRET is missing");
      const response = await fetch(`${baseUrl}/api/cron/monitoring-refresh`, {
        headers: { authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(300_000),
      });
      authenticatedCron = {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    }

    const proof = {
      console: {
        status: consolePage.status,
        rendered:
          consolePage.body.includes("Safety summary") &&
          consolePage.body.includes("Nationwide Carrier") &&
          !consolePage.body.includes("Internal Server Error"),
      },
      portal: {
        status: portalPage.status,
        rendered:
          portalPage.body.includes("Welcome back") &&
          portalPage.body.includes("Nationwide Carrier") &&
          !portalPage.body.includes("Internal Server Error"),
      },
      publicEvidence: {
        status: evidencePage.status,
        rendered: evidencePage.body.includes("Link invalid or expired"),
      },
      cron: {
        unauthenticated: {
          status: unauthenticatedCron.status,
          body: unauthenticatedCronBody,
        },
        authenticated: authenticatedCron,
      },
    };

    const authenticatedCronPassed = "skipped" in authenticatedCron
      ? true
      : authenticatedCron.status === 200 &&
        typeof authenticatedCron.body === "object" &&
        authenticatedCron.body !== null &&
        "clients_processed" in authenticatedCron.body &&
        authenticatedCron.body.clients_processed === 1;

    if (
      proof.console.status !== 200 ||
      !proof.console.rendered ||
      proof.portal.status !== 200 ||
      !proof.portal.rendered ||
      proof.publicEvidence.status !== 200 ||
      !proof.publicEvidence.rendered ||
      proof.cron.unauthenticated.status !== 401 ||
      !authenticatedCronPassed
    ) {
      throw new Error(`Production smoke failed: ${JSON.stringify(proof)}`);
    }

    console.log(JSON.stringify(proof, null, 2));
  } finally {
    const revocations = await Promise.allSettled([staff?.revoke(), client?.revoke()]);
    const revokeFailure = revocations.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (linked) {
      const { error: restoreError } = await service
        .from("users")
        .update({ client_id: null })
        .eq("id", verificationUser.id)
        .eq("client_id", nationwideId);
      if (restoreError) throw restoreError;
    }

    const { data: restored, error: restoreReadError } = await service
      .from("users")
      .select("client_id")
      .eq("id", verificationUser.id)
      .single();
    if (restoreReadError || restored?.client_id !== null) {
      throw restoreReadError ?? new Error("Synthetic verification user link was not restored");
    }
    if (revokeFailure) {
      throw revokeFailure.reason;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
