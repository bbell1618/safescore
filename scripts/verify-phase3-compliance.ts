import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getCanonicalInspectionScope } from "../lib/fmcsa/canonical-inspection-scope";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(/\/$/, "");
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const syntheticId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const session = await createDeployedStaffSession(baseUrl);
  try {
    const pages: Record<string, unknown> = {};
    for (const clientId of [nationwideId, syntheticId]) {
      const response = await fetch(`${baseUrl}/console/clients/${clientId}/compliance`, {
        headers: { cookie: session.cookie },
      });
      const html = await response.text();
      pages[clientId] = {
        status: response.status,
        computedHeading: html.includes("Computed compliance review"),
        containsMockHeading: html.includes("Mock compliance review"),
        containsPassingStatus: />Passing</.test(html),
        containsHazmat: html.includes("Hazardous Materials"),
        issueOnFileLabels: ["37 issues on file", "20 issues on file", "8 issues on file", "5 issues on file", "1 issue on file"].filter((label) => html.includes(label)),
      };
    }

    const requestResponse = await fetch(`${baseUrl}/api/clients/${syntheticId}/requests`, {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        category: "dqf_roster",
        title: "Driver qualification roster and files",
        description: "Provide the current driver roster and driver qualification documents.",
        dedupeKey: "standing:dqf-roster",
      }),
    });
    const requestBody = await requestResponse.json();
    if (!requestResponse.ok) throw new Error(JSON.stringify(requestBody));

    const scope = await getCanonicalInspectionScope(nationwideId, service);
    const [violations, drivers, vehicles, requestRow] = await Promise.all([
      service.from("violations").select("basic_category, violation_code").in("inspection_id", scope.inspectionIds),
      service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", nationwideId).eq("status", "active"),
      service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", nationwideId).eq("status", "active"),
      service.from("client_requests").select("id, category, status, reminder_count, reminder_limit, next_reminder_at").eq("client_id", syntheticId).eq("category", "dqf_roster").single(),
    ]);
    for (const result of [violations, drivers, vehicles, requestRow]) {
      if (result.error) throw result.error;
    }
    const counts = (violations.data ?? []).reduce<Record<string, number>>((out, row) => {
      const key = row.basic_category ?? "unknown";
      out[key] = (out[key] ?? 0) + 1;
      return out;
    }, {});

    console.log(JSON.stringify({ pages, requestRouteStatus: requestResponse.status, request: requestRow.data, nationwide: { source: scope.source, violationsByBasic: counts, activeDrivers: drivers.count, activeVehicles: vehicles.count } }, null, 2));
  } finally {
    await session.revoke();
  }
}

void main();
