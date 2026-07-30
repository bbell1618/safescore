import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { cpdpFiledTimelineLabel } from "../lib/cases/presentation";
import { evaluatePortalFeatureGate } from "../lib/portal/feature-gate";
import { createDeployedClientSession } from "./lib/deployed-client-session";

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

async function main() {
  const [
    userResult,
    playbookResult,
    snapshotsResult,
    alertsResult,
    dataqResult,
    cpdpResult,
    requestsResult,
    documentsResult,
    sentReportsResult,
    draftReportResult,
    accountResult,
    profileResult,
    subscriptionResult,
  ] = await Promise.all([
    service
      .from("users")
      .select("email")
      .eq("client_id", nationwideId)
      .eq("role", "client_user")
      .limit(1)
      .maybeSingle(),
    service
      .from("client_playbooks")
      .select("id, version, source_as_of, family_programs")
      .eq("client_id", nationwideId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("burden_snapshots")
      .select("id, snapshot_date, captured_at, total_points")
      .eq("client_id", nationwideId)
      .order("snapshot_date", { ascending: true })
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true }),
    service
      .from("alerts")
      .select("id, title")
      .eq("client_id", nationwideId)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false }),
    service
      .from("dataq_cases")
      .select("id, case_number, status, filed_date")
      .eq("client_id", nationwideId)
      .order("updated_at", { ascending: false }),
    service
      .from("cpdp_cases")
      .select("id, case_number, status, filed_date")
      .eq("client_id", nationwideId)
      .order("updated_at", { ascending: false }),
    service
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", nationwideId)
      .eq("responsibility", "client")
      .eq("status", "open"),
    service
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("client_id", nationwideId),
    service
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("client_id", nationwideId)
      .eq("status", "sent"),
    service
      .from("reports")
      .select("id, title, final_content")
      .eq("client_id", nationwideId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("clients")
      .select("name, dot_number, mc_number, driver_count, tier")
      .eq("id", nationwideId)
      .single(),
    service
      .from("carrier_profiles")
      .select(
        "power_units, drivers, physical_address, safer_as_of, fetched_at"
      )
      .eq("client_id", nationwideId)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("subscriptions")
      .select("tier, status")
      .eq("client_id", nationwideId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const [label, result] of Object.entries({
    user: userResult,
    playbook: playbookResult,
    snapshots: snapshotsResult,
    alerts: alertsResult,
    dataq: dataqResult,
    cpdp: cpdpResult,
    requests: requestsResult,
    documents: documentsResult,
    sentReports: sentReportsResult,
    draftReport: draftReportResult,
    account: accountResult,
    profile: profileResult,
    subscription: subscriptionResult,
  })) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  assert(userResult.data?.email, "Nationwide has no linked portal user");
  assert(playbookResult.data, "Nationwide has no generated playbook");
  assert(accountResult.data, "Nationwide client row is missing");
  assert(profileResult.data, "Nationwide carrier profile is missing");

  const clientSession = await createDeployedClientSession(
    baseUrl,
    userResult.data.email
  );
  try {
    const pagePaths = [
      "/portal",
      "/portal/playbook",
      "/portal/activity",
      "/portal/documents",
      "/portal/account",
    ] as const;
    const pageResponses = await Promise.all(
      pagePaths.map((path) =>
        fetch(`${baseUrl}${path}`, {
          headers: { cookie: clientSession.cookie },
          redirect: "follow",
        })
      )
    );
    const pageHtml = await Promise.all(
      pageResponses.map((response) => response.text())
    );
    const pages = Object.fromEntries(
      pagePaths.map((path, index) => [
        path,
        {
          response: pageResponses[index]!,
          text: visibleText(pageHtml[index]!),
          html: pageHtml[index]!,
        },
      ])
    ) as Record<
      (typeof pagePaths)[number],
      { response: Response; text: string; html: string }
    >;
    for (const path of pagePaths) {
      assert(
        pages[path].response.status === 200,
        `${path} returned ${pages[path].response.status}`
      );
    }

    const expectedNav = [
      { href: "/portal", label: "Home" },
      { href: "/portal/playbook", label: "Playbook" },
      { href: "/portal/activity", label: "Activity" },
      { href: "/portal/documents", label: "Documents" },
      { href: "/portal/account", label: "Account" },
    ];
    const nav = portalNav(pages["/portal"].html);
    assert(
      JSON.stringify(nav) === JSON.stringify(expectedNav),
      `Portal nav mismatch: ${JSON.stringify(nav)}`
    );

    const familyPrograms = playbookResult.data.family_programs as Array<{
      familyName: string;
      count: number;
      points: number;
      inflowRatePerMonth: number;
    }>;
    const playbookText = pages["/portal/playbook"].text;
    for (const marker of [
      "Your safety playbook",
      "Coaching programs",
      "Your 12-month installment plan",
      "Owner curriculum",
      ...familyPrograms.map((program) => program.familyName),
    ]) {
      assert(playbookText.includes(marker), `Playbook is missing: ${marker}`);
    }
    for (const forbidden of [
      "lane c",
      "truth-up",
      "mapping review",
      "unmapped code",
      "template version",
    ]) {
      assert(
        !playbookText.toLowerCase().includes(forbidden),
        `Playbook exposed internal copy: ${forbidden}`
      );
    }

    const snapshotPoints = (snapshotsResult.data ?? []).map(
      (snapshot) => snapshot.total_points
    );
    const activityText = pages["/portal/activity"].text;
    for (const marker of [
      "Burden trend",
      "Alerts",
      "Case activity",
      ...snapshotPoints.map((points) => points.toLocaleString("en-US")),
      ...(alertsResult.data ?? []).map((alert) => alert.title),
      ...(dataqResult.data ?? []).flatMap((row) =>
        row.case_number ? [row.case_number] : []
      ),
      ...(cpdpResult.data ?? []).flatMap((row) =>
        row.case_number ? [row.case_number] : []
      ),
    ]) {
      assert(activityText.includes(marker), `Activity is missing: ${marker}`);
    }
    assert(
      activityText.includes(
        "Only genuine data errors and crash-preventability are challengeable."
      ),
      "Activity is missing the challengeability framing"
    );
    for (const row of cpdpResult.data ?? []) {
      if (!["filed", "pending"].includes(row.status)) continue;
      const expected = cpdpFiledTimelineLabel(row.filed_date);
      if (expected) {
        assert(
          activityText.includes(expected),
          `Activity is missing CPDP guidance: ${expected}`
        );
      }
    }

    const documentsText = pages["/portal/documents"].text;
    for (const marker of [
      "Needed from you",
      "Your document vault",
      "From GEIA",
    ]) {
      assert(documentsText.includes(marker), `Documents is missing: ${marker}`);
    }
    if ((requestsResult.count ?? 0) === 0) {
      assert(
        documentsText.includes("Nothing needed from you right now"),
        "Documents is missing the no-request state"
      );
    }
    if ((documentsResult.count ?? 0) === 0) {
      assert(
        documentsText.includes("No documents uploaded yet"),
        "Documents is missing the empty vault state"
      );
    }
    if ((sentReportsResult.count ?? 0) === 0) {
      assert(
        documentsText.includes("No reports have been sent yet"),
        "Documents is missing the no-sent-report state"
      );
    }

    const accountText = pages["/portal/account"].text;
    const accountMarkers = [
      accountResult.data.name,
      `USDOT ${accountResult.data.dot_number}`,
      `FMCSA on file: ${profileResult.data.power_units} power units \u00B7 ${profileResult.data.drivers} drivers (MCS-150)`,
      `Your service plan: ${accountResult.data.driver_count} drivers`,
      profileResult.data.physical_address,
      "FMCSA SAFER Company Snapshot",
      "Total Safety",
      userResult.data.email,
    ].filter((value): value is string => Boolean(value));
    for (const marker of accountMarkers) {
      assert(accountText.includes(marker), `Account is missing: ${marker}`);
    }

    const retiredMap = {
      "/portal/safety": "/portal",
      "/portal/plan": "/portal/playbook",
      "/portal/monitoring": "/portal/activity",
      "/portal/cases": "/portal/activity",
      "/portal/requests": "/portal/documents",
      "/portal/reports": "/portal/documents",
      "/portal/profile": "/portal/account",
    } as const;
    const retiredResults = await Promise.all(
      Object.entries(retiredMap).map(async ([from, to]) => {
        const response = await fetch(`${baseUrl}${from}`, {
          headers: { cookie: clientSession.cookie },
          redirect: "manual",
        });
        const location = response.headers.get("location");
        assert(
          response.status === 307 &&
            location !== null &&
            new URL(location, baseUrl).pathname === to,
          `${from} did not 307 to ${to} (${response.status}, ${location})`
        );
        return { from, to, status: response.status };
      })
    );

    let protectedDraftPrint: {
      reportId: string;
      status: number;
      notFoundRendered: boolean;
      contentLeaked: false;
    } | null = null;
    if (draftReportResult.data) {
      const response = await fetch(
        `${baseUrl}/portal/documents/reports/${draftReportResult.data.id}/print`,
        {
          headers: { cookie: clientSession.cookie },
          redirect: "manual",
        }
      );
      const draftPrintHtml = await response.text();
      const draftPrintText = visibleText(draftPrintHtml);
      const contentSnippet = (draftReportResult.data.final_content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const contentLeaked =
        contentSnippet.length >= 30 && draftPrintText.includes(contentSnippet);
      const notFoundRendered =
        response.status === 404 ||
        /(?:page could not be found|\b404\b)/i.test(draftPrintText) ||
        /NEXT_HTTP_ERROR_FALLBACK;404|not-found/i.test(draftPrintHtml);
      assert(
        notFoundRendered && !contentLeaked,
        `Draft report print route was not safely hidden (${JSON.stringify({
          status: response.status,
          visibleStart: draftPrintText.slice(0, 240),
          rawNotFound: /NEXT_HTTP_ERROR_FALLBACK;404|not-found/i.test(
            draftPrintHtml
          ),
          contentLeaked,
        })})`
      );
      protectedDraftPrint = {
        reportId: draftReportResult.data.id,
        status: response.status,
        notFoundRendered,
        contentLeaked: false,
      };
    }

    const tierGate = Object.fromEntries(
      ["assessment", "monitor", "remediate", "total_safety"].map((tier) => [
        tier,
        evaluatePortalFeatureGate(
          tier as "assessment" | "monitor" | "remediate" | "total_safety",
          "playbook_coach"
        ).allowed,
      ])
    );
    assert(
      JSON.stringify(tierGate) ===
        JSON.stringify({
          assessment: false,
          monitor: false,
          remediate: true,
          total_safety: true,
        }),
      `Unexpected playbook tier gate: ${JSON.stringify(tierGate)}`
    );

    console.log(
      JSON.stringify(
        {
          passed: true,
          baseUrl,
          pageStatuses: Object.fromEntries(
            pagePaths.map((path) => [path, pages[path].response.status])
          ),
          nav,
          playbook: {
            id: playbookResult.data.id,
            version: playbookResult.data.version,
            sourceAsOf: playbookResult.data.source_as_of,
            families: familyPrograms.map((program) => ({
              name: program.familyName,
              count: program.count,
              points: program.points,
              inflowRatePerMonth: program.inflowRatePerMonth,
            })),
            internalCopyMatches: [],
            tierGate,
          },
          activity: {
            snapshotPoints,
            snapshots: snapshotsResult.data,
            alertTitles: (alertsResult.data ?? []).map((alert) => alert.title),
            dataqCases: dataqResult.data,
            cpdpCases: cpdpResult.data,
          },
          documents: {
            openRequestCount: requestsResult.count ?? 0,
            vaultDocumentCount: documentsResult.count ?? 0,
            sentReportCount: sentReportsResult.count ?? 0,
            protectedDraftPrint,
          },
          account: {
            company: accountResult.data.name,
            dotNumber: accountResult.data.dot_number,
            fmcsaPowerUnits: profileResult.data.power_units,
            fmcsaDrivers: profileResult.data.drivers,
            servicePlanDrivers: accountResult.data.driver_count,
            saferAddress: profileResult.data.physical_address,
            saferAsOf:
              profileResult.data.safer_as_of ?? profileResult.data.fetched_at,
            tier: accountResult.data.tier,
            subscription: subscriptionResult.data,
          },
          redirects: retiredResults,
          sessionRevokedAfterVerification: true,
        },
        null,
        2
      )
    );
  } finally {
    await clientSession.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
