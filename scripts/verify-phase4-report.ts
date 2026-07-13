import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getClientBurden } from "../lib/analysis/basic-measure-server";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(/\/$/, "");
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const session = await createDeployedStaffSession(baseUrl);
  try {
    const response = await fetch(`${baseUrl}/api/reports/generate`, {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!response.ok) {
      throw new Error(`Report route returned HTTP ${response.status}: ${await response.text()}`);
    }
    if (response.headers.get("content-type") !== "application/pdf") {
      throw new Error(`Unexpected content type: ${response.headers.get("content-type")}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Response does not start with a PDF header");
    }
    const outputDir = resolve(process.cwd(), "output", "pdf");
    const outputPath = resolve(outputDir, "nationwide-safety-report.pdf");
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, bytes);

    const burden = await getClientBurden(clientId, service);
    const [dataq, cpdp] = await Promise.all([
      service.from("dataq_cases").select("id", { count: "exact", head: true }).eq("client_id", clientId).in("status", ["filed", "pending_state", "pending_fmcsa", "reconsidering"]),
      service.from("cpdp_cases").select("id", { count: "exact", head: true }).eq("client_id", clientId).in("status", ["filed", "pending"]),
    ]);
    if (dataq.error) throw dataq.error;
    if (cpdp.error) throw cpdp.error;

    console.log(JSON.stringify({ outputPath, httpStatus: response.status, bytes: bytes.length, contentDisposition: response.headers.get("content-disposition"), burden, openCases: { dataq: dataq.count ?? 0, cpdp: cpdp.count ?? 0, total: (dataq.count ?? 0) + (cpdp.count ?? 0) } }, null, 2));
  } finally {
    await session.revoke();
  }
}

void main();
