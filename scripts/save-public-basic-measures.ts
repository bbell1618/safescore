import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { fetchPublicBasicMeasures } from "../lib/fmcsa/public-basic-measures";
import { PUBLIC_BASIC_ROLLOUT_CLIENT, savePublicBasicMeasures } from "../lib/fmcsa/save-public-basic-measures";
loadEnvConfig(process.cwd());
const clientId = process.argv[2];
const dotNumber = process.argv[3];
if (!clientId || !dotNumber) throw new Error("Usage: save-public-basic-measures.ts <client UUID> <USDOT> [--apply]");
if (![PUBLIC_BASIC_ROLLOUT_CLIENT, "1ce377c6-d9cf-4b2f-8eb1-5b6dadb66d15"].includes(clientId)) throw new Error("Client is outside the authorized goal-loop scope");
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ dryRun: true, clientId, source: await fetchPublicBasicMeasures(dotNumber) }, null, 2));
    return;
  }
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {auth:{persistSession:false,autoRefreshToken:false}});
  console.log(JSON.stringify(await savePublicBasicMeasures(service, clientId, dotNumber, "goal-loop-public-source"), null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
