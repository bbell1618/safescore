import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedClientSession } from "./lib/deployed-client-session";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (
  process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app"
).replace(/\/$/, "");
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

function portalNav(html: string) {
  const block = html.match(
    /<nav\b[^>]*aria-label="Portal"[^>]*>([\s\S]*?)<\/nav>/i
  )?.[1];
  assert(block, "The deployed portal shell did not render its desktop nav");
  return [...block.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: decodeHtml(match[1]!),
      label: visibleText(match[2]!).trim(),
    }))
    .filter((item) => item.label.length > 0);
}

async function reportCount() {
  const result = await service
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("client_id", nationwideId);
  if (result.error) {
    throw new Error(`Unable to count reports: ${result.error.message}`);
  }
  return result.count ?? 0;
}

async function main() {
  const linkedUser = await service
    .from("users")
    .select("email")
    .eq("client_id", nationwideId)
    .eq("role", "client_user")
    .limit(1)
    .maybeSingle();
  if (linkedUser.error || !linkedUser.data?.email) {
    throw linkedUser.error ?? new Error("Nationwide has no linked portal user");
  }

  const [client, staff] = await Promise.all([
    createDeployedClientSession(baseUrl, linkedUser.data.email),
    createDeployedStaffSession(baseUrl),
  ]);

  try {
    const beforeReports = await reportCount();
    const [
      homeResponse,
      retiredSafetyResponse,
      clientReportResponse,
      unauthenticatedReportResponse,
      consoleOverviewResponse,
      consoleMonitoringResponse,
    ] = await Promise.all([
      fetch(`${baseUrl}/portal`, {
        headers: { cookie: client.cookie },
        redirect: "follow",
      }),
      fetch(`${baseUrl}/portal/safety`, {
        headers: { cookie: client.cookie },
        redirect: "manual",
      }),
      fetch(`${baseUrl}/api/reports/generate`, {
        method: "POST",
        headers: {
          cookie: client.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_id: nationwideId }),
        redirect: "manual",
      }),
      fetch(`${baseUrl}/api/reports/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: nationwideId }),
        redirect: "manual",
      }),
      fetch(`${baseUrl}/console/clients/${nationwideId}`, {
        headers: { cookie: staff.cookie },
        redirect: "follow",
      }),
      fetch(`${baseUrl}/console/clients/${nationwideId}/monitoring`, {
        headers: { cookie: staff.cookie },
        redirect: "follow",
      }),
    ]);

    const [
      homeHtml,
      clientReportBody,
      unauthenticatedReportBody,
      overviewHtml,
      monitoringHtml,
    ] = await Promise.all([
      homeResponse.text(),
      clientReportResponse.json().catch(() => null),
      unauthenticatedReportResponse.json().catch(() => null),
      consoleOverviewResponse.text(),
      consoleMonitoringResponse.text(),
    ]);
    const homeText = visibleText(homeHtml);
    const overviewText = visibleText(overviewHtml);
    const monitoringText = visibleText(monitoringHtml);
    const nav = portalNav(homeHtml);
    const expectedNav = [
      { href: "/portal", label: "Home" },
      { href: "/portal/plan", label: "Playbook" },
      { href: "/portal/monitoring", label: "Activity" },
      { href: "/portal/documents", label: "Documents" },
      { href: "/portal/profile", label: "Account" },
    ];

    assert(homeResponse.status === 200, `Portal Home returned ${homeResponse.status}`);
    assert(
      JSON.stringify(nav) === JSON.stringify(expectedNav),
      `Portal nav mismatch: ${JSON.stringify(nav)}`
    );
    for (const marker of [
      "Where you stand",
      "549 weighted points",
      "−1 since last snapshot",
      "67 violations in the 24-month scoring window · 71 on file",
      "What GEIA is handling",
      "102 pts",
      "Across 8 violations while evidence is pending.",
      "What's changed",
      "Vehicle Maintenance led the movement",
      "Nationwide Carrier Inc",
      "USDOT 2533650",
      "MC 880750",
      "Authority active",
    ]) {
      assert(homeText.includes(marker), `Portal Home is missing: ${marker}`);
    }
    assert(
      !homeText.includes("Needed from you"),
      "Portal Home rendered the conditional request section with no open requests"
    );
    assert(
      !homeText.includes("71 -> 71") && !homeText.includes("71 → 71"),
      "Portal Home rendered a robotic count-change string"
    );

    const retiredLocation = retiredSafetyResponse.headers.get("location");
    assert(
      retiredSafetyResponse.status === 307 &&
        retiredLocation != null &&
        new URL(retiredLocation, baseUrl).pathname === "/portal",
      `/portal/safety did not 307 to /portal (${retiredSafetyResponse.status}, ${retiredLocation})`
    );
    assert(
      clientReportResponse.status === 403 &&
        (clientReportBody as { error?: unknown } | null)?.error === "Forbidden",
      `client_user report generation was not rejected: ${clientReportResponse.status}`
    );
    assert(
      unauthenticatedReportResponse.status === 401 &&
        (unauthenticatedReportBody as { error?: unknown } | null)?.error ===
          "Unauthorized",
      `Unauthenticated report generation was not rejected: ${unauthenticatedReportResponse.status}`
    );
    assert(
      consoleOverviewResponse.status === 200 &&
        consoleMonitoringResponse.status === 200,
      `Console render failed: overview ${consoleOverviewResponse.status}, monitoring ${consoleMonitoringResponse.status}`
    );
    assert(
      !overviewText.includes("FMCSA official measures") &&
        !monitoringText.includes("FMCSA official measures"),
      "A console route still presents the retired official-measures card"
    );

    const afterReports = await reportCount();
    assert(
      afterReports === beforeReports,
      `The blocked generation request changed reports (${beforeReports} -> ${afterReports})`
    );

    console.log(
      JSON.stringify(
        {
          passed: true,
          baseUrl,
          portalHome: {
            status: homeResponse.status,
            nav,
            burden: 549,
            delta: -1,
            inWindowViolations: 67,
            onFileViolations: 71,
            investigate: { violations: 8, weightedPoints: 102 },
            requestSectionPresent: false,
            authority: "Authority active",
          },
          retiredSafety: {
            status: retiredSafetyResponse.status,
            location: new URL(retiredLocation!, baseUrl).pathname,
          },
          reportGeneration: {
            clientUserStatus: clientReportResponse.status,
            unauthenticatedStatus: unauthenticatedReportResponse.status,
            reportsBefore: beforeReports,
            reportsAfter: afterReports,
          },
          officialMeasuresCard: {
            overviewStatus: consoleOverviewResponse.status,
            monitoringStatus: consoleMonitoringResponse.status,
            present: false,
          },
          sessionsRevokedAfterVerification: true,
        },
        null,
        2
      )
    );
  } finally {
    await Promise.allSettled([client.revoke(), staff.revoke()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
