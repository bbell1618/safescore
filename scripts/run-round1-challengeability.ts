import { loadEnvConfig } from "@next/env";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

async function main() {
  const staff = await createDeployedStaffSession(baseUrl);
  try {
    const batches = [];
    let hasMore = true;
    while (hasMore) {
      const response = await fetch(`${baseUrl}/api/analysis/assess-violations`, {
        method: "POST",
        headers: { cookie: staff.cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const body = await response.json();
      batches.push({ status: response.status, ...body });
      if (!response.ok) throw new Error(JSON.stringify(batches, null, 2));
      hasMore = Boolean(body.hasMore);
    }
    console.log(JSON.stringify({ batches }, null, 2));
  } finally {
    await staff.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
