import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  mapFmcsaBasicsPayload,
  type FMCSABasicsPayload,
} from "../lib/fmcsa/client";
import {
  monitoringWatchStatusText,
  mostRecentMonitoringCheck,
} from "../lib/monitoring/watch-status";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (
  process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app"
).replace(/\/$/, "");
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const dotNumber = "2533650";
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#x27;|&#39;/g, "'")
    .replace(/&middot;/g, "\u00B7")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    );
}

function visibleText(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function formatFmcsaDate(value: string | null) {
  if (!value) return "date not provided";
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
    ? `${dateOnly}T12:00:00`
    : dateOnly;
  return new Date(normalized).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function fetchPage(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: "follow",
  });
  return { status: response.status, text: visibleText(await response.text()) };
}

async function fetchRawBasics(): Promise<FMCSABasicsPayload> {
  const key = process.env.FMCSA_API_KEY?.trim();
  if (!key) throw new Error("FMCSA_API_KEY is not configured");
  const response = await fetch(
    `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dotNumber}/basics?webKey=${encodeURIComponent(key)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(`FMCSA raw basics request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as FMCSABasicsPayload;
}

async function main() {
  const staff = await createDeployedStaffSession(baseUrl);
  let proof: Record<string, unknown> | null = null;
  let testError: unknown = null;

  try {
    const [monitoring, requests, compliance, rawPayload, runResult, snapshotResult] =
      await Promise.all([
        fetchPage(`/console/clients/${clientId}/monitoring`, staff.cookie),
        fetchPage(`/console/clients/${clientId}/requests`, staff.cookie),
        fetchPage(`/console/clients/${clientId}/compliance`, staff.cookie),
        fetchRawBasics(),
        service
          .from("activity_log")
          .select("id, created_at, metadata")
          .eq("client_id", clientId)
          .filter("metadata->>source", "eq", "monitoring_cron")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        service
          .from("burden_snapshots")
          .select("id, captured_at, source")
          .eq("client_id", clientId)
          .order("snapshot_date", { ascending: false })
          .order("captured_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (runResult.error) throw runResult.error;
    if (snapshotResult.error) throw snapshotResult.error;
    const runSource = runResult.data?.metadata?.source;
    if (runResult.data && typeof runSource !== "string") {
      throw new Error("Latest monitoring run is missing source metadata");
    }
    const lastCheck = mostRecentMonitoringCheck([
      runResult.data && typeof runSource === "string"
        ? {
            timestamp: runResult.data.created_at,
            source: runSource,
            kind: "run",
          }
        : null,
      snapshotResult.data
        ? {
            timestamp: snapshotResult.data.captured_at,
            source: snapshotResult.data.source,
            kind: "snapshot",
          }
        : null,
    ]);
    const expectedWatchStatus = monitoringWatchStatusText({ lastCheck });
    const mapped = mapFmcsaBasicsPayload(rawPayload);

    const officialLabel = `Public FMCSA API \u00B7 FMCSA SMS snapshot ${formatFmcsaDate(mapped.smsSnapshotDate)} \u00B7 fetched ${formatFmcsaDate(mapped.retrievedAt)}.`;
    const cardText = [
      `Unsafe Driving Measure ${mapped.unsafeDriving?.measureValue ?? "Unknown"} Percentile Unknown`,
      `HOS Compliance Measure ${mapped.hosCompliance?.measureValue ?? "Unknown"} Percentile Unknown`,
      `Driver Fitness Measure ${mapped.driverFitness?.measureValue ?? "Unknown"} Percentile Unknown`,
      `Controlled Substances/Alcohol Measure ${mapped.controlledSubstances?.measureValue ?? "Unknown"} Percentile Unknown`,
      `Vehicle Maintenance Measure ${mapped.vehicleMaintenance?.measureValue ?? "Unknown"} Percentile Unknown`,
      `HM Compliance Measure ${mapped.hmCompliance?.measureValue ?? "Unknown"} Percentile Unknown`,
      `Crash Indicator Measure ${mapped.crashIndicator?.measureValue ?? "Unknown"} Percentile Unknown`,
    ];
    const complianceText = [
      "Counts all on-file violations \u2014 audit exposure is not limited to the 24-month scoring window.",
      "71 violations on file \u00B7 68 in scoring window \u00B7 3 aged out but audit-relevant.",
      "Needs review - 37 issues on file",
      "Needs review - 1 issue on file",
      "Needs review - 8 issues on file",
      "Needs review - 20 issues on file \u00B7 17 in scoring window, 3 aged out but audit-relevant",
      "Needs review - 5 issues on file",
      "No issues on file",
    ];
    const requestCopy =
      "Requests are created when SafeScore needs evidence or documents from the carrier \u2014 reminders and escalation are tracked automatically.";

    const checks = {
      monitoringStatus: monitoring.status === 200,
      watchStatus: monitoring.text.includes(expectedWatchStatus),
      officialLabel: monitoring.text.includes(officialLabel),
      officialCards: cardText.every((value) => monitoring.text.includes(value)),
      requestsStatus: requests.status === 200,
      requestsEmptyCopy: requests.text.includes(requestCopy),
      complianceStatus: compliance.status === 200,
      complianceCopy: complianceText.every((value) => compliance.text.includes(value)),
      noLiveIssues: !compliance.text.toLowerCase().includes("live issue"),
    };
    if (Object.values(checks).some((value) => !value)) {
      throw new Error(`Round 3 deployed checks failed: ${JSON.stringify(checks)}`);
    }

    proof = {
      checks,
      rendered: {
        officialLabel,
        officialCards: cardText,
        watchStatus: expectedWatchStatus,
        requestsEmptyCopy: requestCopy,
        compliance: complianceText,
      },
      sources: {
        latestRun: runResult.data,
        latestSnapshot: snapshotResult.data,
        smsSnapshotDate: mapped.smsSnapshotDate,
        retrievedAt: mapped.retrievedAt,
      },
      rawPayload,
    };
  } catch (error) {
    testError = error;
  } finally {
    const cleanupErrors: string[] = [];
    try {
      await staff.revoke();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    console.log(
      JSON.stringify(
        { proof, cleanup: { staffSessionRevoked: cleanupErrors.length === 0, errors: cleanupErrors } },
        null,
        2
      )
    );
    if (cleanupErrors.length > 0) {
      throw new Error(`Round 3 cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  }

  if (testError) throw testError;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
