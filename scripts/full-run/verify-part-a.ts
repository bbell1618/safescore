import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "../lib/deployed-staff-session";
import { getClientBurden } from "../../lib/analysis/basic-measure-server";

loadEnvConfig(process.cwd());

const baseUrl = (process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app").replace(/\/$/, "");
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const [cpdp, dataq, cpdpEvidence, dataqEvidence, inspections, violations, crashes, burden] =
    await Promise.all([
      service.from("cpdp_cases").select("id,case_number,status,crash_id,crashes(report_number,crash_date,state)").eq("client_id", clientId).eq("case_number", "6123719").single(),
      service.from("dataq_cases").select("id,case_number,status,inspection_id,violation_id,inspections(report_number,inspection_date,state),violations(violation_code)").eq("client_id", clientId).eq("case_number", "6103911").single(),
      service.from("cpdp_evidence").select("id,label,status,storage_path").eq("case_id", "46afb92a-b2da-4c85-b362-392ebf5c1cf5").order("created_at"),
      service.from("dataq_evidence").select("id,label,status,storage_path").eq("case_id", "147054ba-7ec6-44e5-aa4c-6788c099fbc3").order("created_at"),
      service.from("inspections").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      service.from("violations").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      service.from("crashes").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      getClientBurden(clientId, service),
    ]);
  for (const result of [cpdp, dataq, cpdpEvidence, dataqEvidence, inspections, violations, crashes]) {
    if (result.error) throw result.error;
  }

  const session = await createDeployedStaffSession(baseUrl);
  try {
    const response = await fetch(`${baseUrl}/console/clients/${clientId}/cases`, {
      headers: { cookie: session.cookie },
    });
    const html = await response.text();
    if (!response.ok || !html.includes("6123719") || !html.includes("6103911")) {
      throw new Error(`Cases page gate failed: HTTP ${response.status}`);
    }
    console.log(JSON.stringify({
      cases: { cpdp: cpdp.data, dataq: dataq.data },
      evidence: { cpdp: cpdpEvidence.data, dataq: dataqEvidence.data },
      core: {
        inspections: inspections.count,
        violations: violations.count,
        crashes: crashes.count,
        burden: burden.totalPoints,
      },
      deployedCasesPage: {
        status: response.status,
        bytes: Buffer.byteLength(html),
        cpdpRendered: html.includes("6123719"),
        dataqRendered: html.includes("6103911"),
        filedPendingRendered: html.includes("Filed / Pending FMCSA"),
      },
    }, null, 2));
  } finally {
    await session.revoke();
  }
}

void main();
