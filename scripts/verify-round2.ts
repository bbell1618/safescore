import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (
  process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app"
).replace(/\/$/, "");
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const cpdpCaseId = "46afb92a-b2da-4c85-b362-392ebf5c1cf5";
const syntheticEmail = "safescore-phase11-acme@example.com";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function visibleText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: "follow",
  });
  const body = await response.text();
  return { status: response.status, text: visibleText(body) };
}

async function main() {
  const { data: verificationUser, error: verificationUserError } = await service
    .from("users")
    .select("id, role, client_id")
    .eq("email", syntheticEmail)
    .single();
  if (verificationUserError || !verificationUser) {
    throw verificationUserError ?? new Error("Synthetic verification user is missing");
  }
  if (
    verificationUser.role !== "client_user" ||
    verificationUser.client_id !== null
  ) {
    throw new Error("Synthetic verification user is not at the expected baseline");
  }

  const authUserResult = await service.auth.admin.getUserById(verificationUser.id);
  if (authUserResult.error || !authUserResult.data.user) {
    throw authUserResult.error ?? new Error("Synthetic auth user is missing");
  }
  const originalMetadata = authUserResult.data.user.user_metadata ?? {};

  let linked = false;
  let metadataElevated = false;
  let staff: Awaited<ReturnType<typeof createDeployedStaffSession>> | null = null;
  let client: Awaited<ReturnType<typeof createDeployedClientSession>> | null = null;
  let proof: Record<string, unknown> | null = null;
  let testFailure: unknown = null;

  try {
    const elevated = await service.auth.admin.updateUserById(verificationUser.id, {
      user_metadata: { ...originalMetadata, role: "geia_admin" },
    });
    if (elevated.error) throw elevated.error;
    metadataElevated = true;

    const { data: linkedUser, error: linkError } = await service
      .from("users")
      .update({ client_id: nationwideId })
      .eq("id", verificationUser.id)
      .eq("role", "client_user")
      .is("client_id", null)
      .select("id")
      .single();
    if (linkError || !linkedUser) {
      throw linkError ?? new Error("Could not establish the temporary portal link");
    }
    linked = true;

    [staff, client] = await Promise.all([
      createDeployedStaffSession(baseUrl),
      createDeployedClientSession(baseUrl, syntheticEmail),
    ]);

    const [remediation, cpdp, dataq, portal, clientConsole, clientImport] =
      await Promise.all([
        fetchPage(`/console/clients/${nationwideId}/remediation`, staff.cookie),
        fetchPage(
          `/console/clients/${nationwideId}/cpdp/${cpdpCaseId}`,
          staff.cookie
        ),
        fetchPage(`/console/clients/${nationwideId}/dataq`, staff.cookie),
        fetchPage("/portal", client.cookie),
        fetch(`${baseUrl}/console`, {
          headers: { cookie: client.cookie },
          redirect: "manual",
        }),
        fetch(`${baseUrl}/api/analysis/import`, {
          method: "POST",
          headers: {
            cookie: client.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ clientId: nationwideId, dotNumber: "2533650" }),
          redirect: "manual",
        }),
      ]);

    const checks = {
      remediation:
        remediation.status === 200 &&
        remediation.text.includes(
          "Under investigation: 102 pts (19%) across 8 violations — evidence pending."
        ) &&
        remediation.text.includes("What next") &&
        remediation.text.includes("Open case workbench") &&
        remediation.text.includes("No filing action"),
      cpdp:
        cpdp.status === 200 &&
        cpdp.text.includes(
          "No signed filing authorization on file for this filing — upload in onboarding Step 3."
        ) &&
        cpdp.text.includes("Filed Jun 9 · determination expected ~Aug 10") &&
        cpdp.text.includes("Filed / Pending FMCSA") &&
        !cpdp.text.includes(
          "obtain the client's authorization (onboarding Step 3) before filing"
        ),
      dataq:
        dataq.status === 200 && dataq.text.includes("Filed / Pending FMCSA"),
      portal:
        portal.status === 200 &&
        portal.text.includes("Nationwide Carrier") &&
        !portal.text.includes("Internal Server Error"),
      metadataCannotEnterConsole:
        [302, 303, 307, 308].includes(clientConsole.status) &&
        (clientConsole.headers.get("location") ?? "").includes("/portal"),
      metadataCannotRunStaffImport: clientImport.status === 403,
    };

    if (Object.values(checks).some((passed) => !passed)) {
      throw new Error(`Round 2 deployed checks failed: ${JSON.stringify(checks)}`);
    }

    proof = {
      checks,
      rendered: {
        remediation:
          "Under investigation: 102 pts (19%) across 8 violations — evidence pending.",
        authorization:
          "No signed filing authorization on file for this filing — upload in onboarding Step 3.",
        cpdpTimeline: "Filed Jun 9 · determination expected ~Aug 10",
        filedStatus: "Filed / Pending FMCSA",
      },
      responses: {
        remediation: remediation.status,
        cpdp: cpdp.status,
        dataq: dataq.status,
        portal: portal.status,
        clientConsole: {
          status: clientConsole.status,
          location: clientConsole.headers.get("location"),
        },
        clientImport: clientImport.status,
      },
    };
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupErrors: string[] = [];

    if (linked) {
      const { error } = await service
        .from("users")
        .update({ client_id: null })
        .eq("id", verificationUser.id)
        .eq("client_id", nationwideId);
      if (error) cleanupErrors.push(`client link restore: ${error.message}`);
    }

    if (metadataElevated) {
      const restoredMetadata = await service.auth.admin.updateUserById(
        verificationUser.id,
        { user_metadata: { ...originalMetadata, role: null } }
      );
      if (restoredMetadata.error) {
        cleanupErrors.push(`metadata restore: ${restoredMetadata.error.message}`);
      }
    }

    const revocations = await Promise.allSettled([staff?.revoke(), client?.revoke()]);
    for (const result of revocations) {
      if (result.status === "rejected") {
        cleanupErrors.push(
          `session revoke: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`
        );
      }
    }

    const [{ data: restoredProfile, error: restoredProfileError }, restoredAuth] =
      await Promise.all([
        service
          .from("users")
          .select("role, client_id")
          .eq("id", verificationUser.id)
          .single(),
        service.auth.admin.getUserById(verificationUser.id),
      ]);
    if (restoredProfileError) cleanupErrors.push(restoredProfileError.message);
    if (restoredAuth.error) cleanupErrors.push(restoredAuth.error.message);

    const cleanup = {
      profileRole: restoredProfile?.role ?? null,
      clientId: restoredProfile?.client_id ?? null,
      metadataRole: restoredAuth.data.user?.user_metadata?.role ?? null,
      sessionRevocationsAttempted: revocations.length,
      errors: cleanupErrors,
    };

    console.log(JSON.stringify({ proof, cleanup }, null, 2));
    if (cleanupErrors.length > 0) {
      throw new Error(`Round 2 cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  }

  if (testFailure) throw testFailure;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
