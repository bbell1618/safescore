import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { getClientBasicReconciliation } from "../lib/analysis/basic-reconciliation-server";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const clientId = "557e0cd2-d121-4768-bbc9-04f87af838fa";
const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const reconciliation = await getClientBasicReconciliation(clientId, service);
  const rows = reconciliation.burden.perBasic.map((basic) => ({
    basic: basic.label,
    weightedBurdenPoints: basic.weightedPoints,
    scoredViolationCount: basic.violationCount,
    potentialRemovalImpactPoints:
      reconciliation.potentialRemovalImpactByBasic[basic.basicCategory] ?? 0,
  }));
  const staff = await createDeployedStaffSession(baseUrl);
  try {
    const response = await fetch(`${baseUrl}/console/clients/${clientId}`, {
      headers: { cookie: staff.cookie },
      redirect: "manual",
    });
    const html = await response.text();
    const exactLabels = [
      "In-window weighted burden (points)",
      "Scored violations (count)",
      "Potential removal impact (points)",
    ];
    const rendered = Object.fromEntries(exactLabels.map((label) => [label, html.includes(label)]));
    if (response.status !== 200 || Object.values(rendered).includes(false)) {
      throw new Error(`Rendered reconciliation failed: ${response.status} ${JSON.stringify(rendered)}`);
    }
    console.log(JSON.stringify({
      routeStatus: response.status,
      exactLabels,
      rendered,
      rows,
      unknownRow: {
        count: reconciliation.unknownBasicCount,
        burdenLabel: "Not computed",
        removalImpactLabel: "Not assessed",
      },
      queryTrace: reconciliation.queryTrace,
    }, null, 2));
  } finally {
    await staff.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
