import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "../lib/deployed-staff-session";
import { captureBurdenSnapshot } from "../../lib/monitoring/snapshot";
import { getClientBurden } from "../../lib/analysis/basic-measure-server";

loadEnvConfig(process.cwd());

const baseUrl = (process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app").replace(/\/$/, "");
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const browserSession = "safescore-full-part-b";
const browserCommand = "C:\\Users\\info\\AppData\\Roaming\\npm\\agent-browser.ps1";
const runAgentBrowser = process.env.RUN_AGENT_BROWSER === "true";

const routes = [
  ["Console", "/console", "Client overview"],
  ["Activity", "/console/activity", "Activity"],
  ["Quick Assess", "/console/assess/2533650", "Nationwide Carrier Inc"],
  ["Overview", `/console/clients/${clientId}`, "In-window weighted burden (points)"],
  ["Violations", `/console/clients/${clientId}/violations`, "Violation analyzer"],
  ["Remediation", `/console/clients/${clientId}/remediation`, "Action queue"],
  ["Cases", `/console/clients/${clientId}/cases`, "6123719"],
  ["Monitoring", `/console/clients/${clientId}/monitoring`, "SafeScore computed burden"],
  ["Compliance", `/console/clients/${clientId}/compliance`, "Computed compliance review"],
  ["Reports", `/console/clients/${clientId}/reports`, "Reports"],
  ["Account", `/console/clients/${clientId}/account`, "Account"],
  ["DataQs workbench", `/console/clients/${clientId}/dataq`, "6103911"],
  ["CPDP workbench", `/console/clients/${clientId}/cpdp`, "CPDP workbench"],
  ["CPDP detail", `/console/clients/${clientId}/cpdp/46afb92a-b2da-4c85-b362-392ebf5c1cf5`, "6123719"],
  ["Requests", `/console/clients/${clientId}/requests`, "Client Request Queue"],
] as const;

function browser(args: string[]) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", browserCommand, "--session", browserSession, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

async function counts(service: SupabaseClient) {
  const tables = ["inspections", "violations", "crashes", "reports", "score_snapshots", "burden_snapshots", "activity_log", "cpdp_cases", "dataq_cases"];
  const out: Record<string, number> = {};
  for (const table of tables) {
    const result = await service.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    out[table] = result.count ?? 0;
  }
  return out;
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const before = await counts(service);
  const session = await createDeployedStaffSession(baseUrl);
  try {
    const pages: Array<{ name: string; path: string; status: number; bytes: number; marker: boolean }> = [];
    for (const [name, path, marker] of routes) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: session.cookie } });
      const html = await response.text();
      const rendered = response.ok && html.includes(marker);
      pages.push({ name, path, status: response.status, bytes: Buffer.byteLength(html), marker: rendered });
      if (!rendered) throw new Error(`${name} failed: HTTP ${response.status}, marker ${marker}`);
    }

    const monitoring = await captureBurdenSnapshot(clientId, "full-run", service);
    if (monitoring.status !== "unchanged" || monitoring.totalPoints !== 582) {
      throw new Error(`Monitoring dedupe failed: ${JSON.stringify(monitoring)}`);
    }

    const reportPath = resolve(process.cwd(), "output", "pdf", "nationwide-full-run-report.pdf");
    let reportBytes: Buffer;
    let reportMeta: Record<string, unknown>;
    if (before.reports === 0) {
      const reportResponse = await fetch(`${baseUrl}/api/reports/generate`, {
        method: "POST",
        headers: { cookie: session.cookie, "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (!reportResponse.ok || reportResponse.headers.get("content-type") !== "application/pdf") {
        throw new Error(`Report generation failed: HTTP ${reportResponse.status}`);
      }
      reportBytes = Buffer.from(await reportResponse.arrayBuffer());
      await mkdir(resolve(process.cwd(), "output", "pdf"), { recursive: true });
      await writeFile(reportPath, reportBytes);
      reportMeta = {
        generated: true,
        status: reportResponse.status,
        contentType: reportResponse.headers.get("content-type"),
        disposition: reportResponse.headers.get("content-disposition"),
      };
    } else {
      if (before.reports !== 1) throw new Error(`Expected exactly one retained report, found ${before.reports}`);
      reportBytes = await readFile(reportPath);
      reportMeta = { generated: false, retainedAuthorizedReport: true };
    }
    if (reportBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF header");

    let violationsBrowser: Record<string, unknown> = { status: "blocked", reason: "agent-browser daemon unavailable; in-app browser cannot establish the deployed staff cookie" };
    if (runAgentBrowser) {
      try { browser(["close"]); } catch {}
      for (const pair of session.cookie.split(/;\s*/)) {
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        browser(["cookies", "set", name, value, "--url", baseUrl, "--httpOnly", "--secure", "--sameSite", "Lax"]);
      }
      browser(["open", `${baseUrl}/console/clients/${clientId}/violations`]);
      browser(["wait", "3000"]);
      const errorsBefore = browser(["errors"]);
      browser(["find", "placeholder", "Code or description", "fill", "39530B1"]);
      browser(["wait", "500"]);
      const filtered = browser(["eval", "JSON.stringify({rows:document.querySelectorAll('tbody tr[role=button]').length,code:document.body.innerText.includes('39530B1')})"]);
      browser(["eval", "document.querySelector('tbody tr[role=button]')?.click(); 'clicked'"]);
      browser(["wait", "300"]);
      const expanded = browser(["eval", "JSON.stringify({expanded:document.body.innerText.includes('Evidence checklist'),aria:document.querySelector('tbody tr[role=button]')?.getAttribute('aria-expanded')})"]);
      const screenshotPath = resolve(process.cwd(), "output", "full-run", "part-b-violations.png");
      await mkdir(resolve(process.cwd(), "output", "full-run"), { recursive: true });
      browser(["screenshot", screenshotPath, "--full"]);
      const errorsAfter = browser(["errors"]);
      violationsBrowser = { status: "passed", filtered, expanded, errorsBefore, errorsAfter, screenshotPath };
    }

    const after = await counts(service);
    const expectedReportCount = before.reports === 0 ? 1 : before.reports;
    if (after.reports !== expectedReportCount) {
      throw new Error(`Expected ${expectedReportCount} report row after generation, found ${after.reports}`);
    }
    for (const [table, count] of Object.entries(before)) {
      if (table !== "reports" && after[table] !== count) {
        throw new Error(`${table} changed unexpectedly: ${count} -> ${after[table]}`);
      }
    }
    const burden = await getClientBurden(clientId, service);
    console.log(JSON.stringify({
      pages,
      monitoring,
      report: {
        path: reportPath,
        bytes: reportBytes.length,
        ...reportMeta,
      },
      violationsBrowser,
      before,
      after,
      burden: burden.totalPoints,
    }, null, 2));
  } finally {
    if (runAgentBrowser) {
      try { browser(["close"]); } catch {}
    }
    await session.revoke();
  }
}

void main();
