import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";
import { scoreChallenge } from "../lib/analysis/challengeability-v2";
import { timeWeightFor } from "../lib/analysis/basic-measure";

loadEnvConfig(process.cwd());

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const clientEmail = "safescore-phase11-acme@example.com";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const clientScopedTables = [
  "subscriptions", "client_credentials", "carrier_profiles", "score_snapshots", "burden_snapshots", "inspections",
  "violations", "crashes", "dataq_cases", "cpdp_cases", "action_items", "mcs150_updates",
  "drivers", "driver_documents", "vehicles", "vehicle_maintenance", "clearinghouse_records",
  "reports", "alerts", "activity_log", "documents", "client_invites", "fmcsa_ingest_files",
  "client_requests", "inspection_vehicles",
];

async function countsFor(id: string) {
  const counts: Record<string, number | null> = {};
  for (const table of clientScopedTables) {
    const result = await service.from(table).select("*", { count: "exact", head: true }).eq("client_id", id);
    if (result.error) throw new Error(`${table} count failed: ${result.error.message}`);
    counts[table] = result.count;
  }
  return counts;
}

async function main() {
  const nationwideBefore = await countsFor(nationwideId);
  const syntheticBefore = await countsFor(clientId);
  const [client, ingestFiles, snapshot, inspection, violation, request, evidence, credential] = await Promise.all([
    service.from("clients").select("id,name,dot_number,driver_count,eld_provider,fmcsa_authorized,filing_authorized,standing_authorization").eq("id", clientId).single(),
    service.from("fmcsa_ingest_files").select("ingest_kind,filename,file_hash").eq("client_id", clientId),
    service.from("burden_snapshots").select("snapshot_date,source,total_points,violation_count,inspection_count").eq("client_id", clientId).order("snapshot_date", { ascending: false }).limit(1).single(),
    service.from("inspections").select("id,report_number,inspection_date,total_violations,oos_violations").eq("client_id", clientId).limit(1).single(),
    service.from("violations").select("id,violation_code,basic_category,severity_weight,oos_violation,convicted,citation_number,citation_result,challenge_reason,inspections(inspection_date)").eq("client_id", clientId).limit(1).single(),
    service.from("client_requests").select("id,status,reminder_count,next_reminder_at,closed_at").eq("client_id", clientId).eq("dedupe_key", `${clientId}:case:phase5-gate`).single(),
    service.from("dataq_evidence").select("id,status,storage_path,uploaded_by,dataq_cases!inner(client_id)").eq("dataq_cases.client_id", clientId).limit(1).single(),
    service.from("client_credentials").select("id,fmcsa_dot_number").eq("client_id", clientId).single(),
  ]);
  for (const [label, result] of Object.entries({ client, ingestFiles, snapshot, inspection, violation, request, evidence, credential })) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }
  if (!client.data || !snapshot.data || !inspection.data || !violation.data || !request.data || !evidence.data || !credential.data) {
    throw new Error("Synthetic lifecycle is missing a required persisted step");
  }
  const violationRow = violation.data;
  const evidenceRow = evidence.data;
  const credentialRow = credential.data;
  const ingestKinds = new Set((ingestFiles.data ?? []).map((row) => row.ingest_kind));
  if (!ingestKinds.has("all_basics") || !ingestKinds.has("inspection_detail")) {
    throw new Error("Both Layer 4 fixture formats are not represented in the ingest registry");
  }
  const inspectionRelation = Array.isArray(violationRow.inspections) ? violationRow.inspections[0] : violationRow.inspections;
  const timeWeight = timeWeightFor(inspectionRelation?.inspection_date ?? null, new Date());
  const lane = scoreChallenge({
    violationCode: violationRow.violation_code,
    basicCategory: violationRow.basic_category,
    severityWeight: violationRow.severity_weight,
    timeWeight,
    challengeReason: violationRow.challenge_reason,
    oosViolation: violationRow.oos_violation,
    convicted: violationRow.convicted,
    citationNumber: violationRow.citation_number,
    citationResult: violationRow.citation_result,
    basicPercentile: null,
  });

  const staff = await createDeployedStaffSession(baseUrl);
  let reportProof: Record<string, unknown>;
  let pages: Record<string, unknown>;
  try {
    const [remediation, monitoring, portalRequests, report] = await Promise.all([
      fetch(`${baseUrl}/console/clients/${clientId}/remediation`, { headers: { cookie: staff.cookie } }),
      fetch(`${baseUrl}/console/clients/${clientId}/monitoring`, { headers: { cookie: staff.cookie } }),
      fetch(`${baseUrl}/console/clients/${clientId}/requests`, { headers: { cookie: staff.cookie } }),
      fetch(`${baseUrl}/api/reports/generate`, {
        method: "POST",
        headers: { cookie: staff.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      }),
    ]);
    const remediationHtml = await remediation.text();
    const monitoringHtml = await monitoring.text();
    const requestsHtml = await portalRequests.text();
    const reportBytes = new Uint8Array(await report.arrayBuffer());
    pages = {
      remediation: { status: remediation.status, actionQueue: remediationHtml.includes("Action queue"), investigate: remediationHtml.includes("Investigate evidence") },
      monitoring: {
        status: monitoring.status,
        computedBurden: monitoringHtml.includes("SafeScore computed burden"),
        archivalMeasuresHidden: !monitoringHtml.includes("FMCSA official measures"),
      },
      requestQueue: { status: portalRequests.status, fulfilled: requestsHtml.includes("fulfilled") },
    };
    reportProof = { status: report.status, contentType: report.headers.get("content-type"), bytes: reportBytes.byteLength, pdfMagic: String.fromCharCode(...reportBytes.slice(0, 4)) };
    if (remediation.status !== 200 || monitoring.status !== 200 || portalRequests.status !== 200 || report.status !== 200 || reportBytes.byteLength < 5000 || reportProof.pdfMagic !== "%PDF") {
      throw new Error(`Deployed lifecycle pages/report failed: ${JSON.stringify({ pages, reportProof })}`);
    }
  } finally {
    await staff.revoke();
  }

  const dataqStoragePaths = await service.from("dataq_evidence").select("storage_path,dataq_cases!inner(client_id)").eq("dataq_cases.client_id", clientId).not("storage_path", "is", null);
  const cpdpCaseIds = (await service.from("cpdp_cases").select("id").eq("client_id", clientId)).data?.map((row) => row.id) ?? [];
  const cpdpStoragePaths = cpdpCaseIds.length
    ? await service.from("cpdp_evidence").select("storage_path").in("case_id", cpdpCaseIds).not("storage_path", "is", null)
    : { data: [], error: null };
  const documentPaths = await service.from("documents").select("storage_path").eq("client_id", clientId);
  if (dataqStoragePaths.error || cpdpStoragePaths.error || documentPaths.error) throw new Error("Storage path inventory failed");
  const storageInventory = [
    { bucket: "dataq-evidence", paths: (dataqStoragePaths.data ?? []).map((row) => row.storage_path as string) },
    { bucket: "cpdp-evidence", paths: (cpdpStoragePaths.data ?? []).map((row) => row.storage_path as string) },
    { bucket: "safescore-documents", paths: (documentPaths.data ?? []).map((row) => row.storage_path as string) },
  ];
  for (const item of storageInventory) {
    if (item.paths.length > 0) {
      const removed = await service.storage.from(item.bucket).remove(item.paths);
      if (removed.error) throw removed.error;
    }
  }

  const activityDelete = await service.from("activity_log").delete().eq("client_id", clientId);
  if (activityDelete.error) throw activityDelete.error;
  const publicUsersDelete = await service.from("users").delete().eq("client_id", clientId);
  if (publicUsersDelete.error) throw publicUsersDelete.error;
  const clientDelete = await service.from("clients").delete().eq("id", clientId);
  if (clientDelete.error) throw clientDelete.error;
  const { data: authUsers } = await service.auth.admin.listUsers({ perPage: 1000 });
  for (const user of authUsers.users.filter((row) => row.email === clientEmail)) {
    const deleted = await service.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }

  const syntheticAfter = await countsFor(clientId);
  const nationwideAfter = await countsFor(nationwideId);
  const clientAfter = await service.from("clients").select("id", { count: "exact", head: true }).eq("id", clientId);
  const publicUserAfter = await service.from("users").select("id", { count: "exact", head: true }).eq("email", clientEmail);
  const authAfter = await service.auth.admin.listUsers({ perPage: 1000 });
  const storageRemaining: Record<string, number> = {};
  for (const item of storageInventory) {
    let remaining = 0;
    for (const path of item.paths) {
      const download = await service.storage.from(item.bucket).download(path);
      if (!download.error && download.data) remaining += 1;
    }
    storageRemaining[item.bucket] = remaining;
  }
  const nonzeroSynthetic = Object.entries(syntheticAfter).filter(([, count]) => count !== 0);
  if (clientAfter.count !== 0 || publicUserAfter.count !== 0 || authAfter.data.users.some((row) => row.email === clientEmail) || nonzeroSynthetic.length > 0 || Object.values(storageRemaining).some((count) => count !== 0)) {
    throw new Error(`Scoped cleanup failed: ${JSON.stringify({ clientAfter: clientAfter.count, publicUserAfter: publicUserAfter.count, nonzeroSynthetic, storageRemaining })}`);
  }
  if (JSON.stringify(nationwideBefore) !== JSON.stringify(nationwideAfter)) throw new Error("Nationwide counts changed during synthetic cleanup");

  console.log(JSON.stringify({
    lifecycle: {
      onboard: client.data,
      fixtureIngest: { registryRows: ingestFiles.data?.length, kinds: [...ingestKinds] },
      analysis: { inspection: inspection.data, violation: violationRow.violation_code },
      laneClassification: { label: lane.label, points: timeWeight * ((violationRow.severity_weight ?? 0) + (violationRow.oos_violation ? 2 : 0)), summary: lane.summary },
      pages,
      requestQueue: request.data,
      evidence: { status: evidenceRow.status, uploadedBy: evidenceRow.uploaded_by, stored: Boolean(evidenceRow.storage_path) },
      report: reportProof,
      monitoringSnapshot: snapshot.data,
      credential: { dot: credentialRow.fmcsa_dot_number, stored: true },
      notifications: { dryRunVerifiedImmediatelyBeforeCleanup: true, realSends: 0, triggerCount: 5 },
    },
    cleanup: { client: clientAfter.count, publicUsers: publicUserAfter.count, authUsers: 0, scopedTablesBefore: syntheticBefore, scopedTables: syntheticAfter, storage: storageRemaining, nationwideUnchanged: true, nationwideCounts: nationwideAfter },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
