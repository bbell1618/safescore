import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const clientEmail = "safescore-phase11-acme@example.com";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const scopedTables = [
  "subscriptions", "client_credentials", "carrier_profiles", "score_snapshots", "burden_snapshots", "inspections",
  "violations", "crashes", "dataq_cases", "cpdp_cases", "action_items", "mcs150_updates", "drivers",
  "driver_documents", "vehicles", "vehicle_maintenance", "clearinghouse_records", "reports", "alerts",
  "activity_log", "documents", "client_invites", "fmcsa_ingest_files", "client_requests", "inspection_vehicles",
];

async function counts() {
  const result: Record<string, number> = {};
  for (const table of scopedTables) {
    const query = await service.from(table).select("*", { count: "exact", head: true }).eq("client_id", clientId);
    if (query.error) throw new Error(`${table}: ${query.error.message}`);
    result[table] = query.count ?? 0;
  }
  return result;
}

async function main() {
  const before = await counts();
  const dataq = await service.from("dataq_cases").select("id").eq("client_id", clientId);
  const cpdp = await service.from("cpdp_cases").select("id").eq("client_id", clientId);
  if (dataq.error || cpdp.error) throw dataq.error ?? cpdp.error;
  const dataqIds = (dataq.data ?? []).map((row) => row.id);
  const cpdpIds = (cpdp.data ?? []).map((row) => row.id);
  const dataqPaths = dataqIds.length
    ? await service.from("dataq_evidence").select("storage_path").in("case_id", dataqIds).not("storage_path", "is", null)
    : { data: [], error: null };
  const cpdpPaths = cpdpIds.length
    ? await service.from("cpdp_evidence").select("storage_path").in("case_id", cpdpIds).not("storage_path", "is", null)
    : { data: [], error: null };
  const documents = await service.from("documents").select("storage_path").eq("client_id", clientId).not("storage_path", "is", null);
  if (dataqPaths.error || cpdpPaths.error || documents.error) throw dataqPaths.error ?? cpdpPaths.error ?? documents.error;
  const casePaths = [...(dataqPaths.data ?? []), ...(cpdpPaths.data ?? [])].map((row) => row.storage_path as string);
  if (casePaths.length) {
    const removed = await service.storage.from("dataq-evidence").remove(casePaths);
    if (removed.error) throw removed.error;
  }
  const documentPaths = (documents.data ?? []).map((row) => row.storage_path as string);
  if (documentPaths.length) {
    const removed = await service.storage.from("documents").remove(documentPaths);
    if (removed.error) throw removed.error;
  }

  const activity = await service.from("activity_log").delete().eq("client_id", clientId);
  if (activity.error) throw activity.error;
  const users = await service.from("users").delete().eq("client_id", clientId);
  if (users.error) throw users.error;
  const deleted = await service.from("clients").delete().eq("id", clientId);
  if (deleted.error) throw deleted.error;
  const authUsers = await service.auth.admin.listUsers({ perPage: 1000 });
  if (authUsers.error) throw authUsers.error;
  for (const user of authUsers.data.users.filter((row) => row.email === clientEmail)) {
    const authDelete = await service.auth.admin.deleteUser(user.id);
    if (authDelete.error) throw authDelete.error;
  }

  const after = await counts();
  const clientCount = await service.from("clients").select("id", { count: "exact", head: true }).eq("id", clientId);
  const totalClients = await service.from("clients").select("id", { count: "exact", head: true });
  const remainingAuth = await service.auth.admin.listUsers({ perPage: 1000 });
  const nonzero = Object.entries(after).filter(([, count]) => count !== 0);
  if (clientCount.count !== 0 || totalClients.count !== 1 || nonzero.length || remainingAuth.data.users.some((row) => row.email === clientEmail)) {
    throw new Error(`Cleanup failed: ${JSON.stringify({ client: clientCount.count, totalClients: totalClients.count, nonzero })}`);
  }
  console.log(JSON.stringify({ clientId, before, after, client: 0, authUsers: 0, storageObjectsRemoved: casePaths.length + documentPaths.length, totalClients: totalClients.count }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
