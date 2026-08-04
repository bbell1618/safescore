import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const TARGET_CLIENT_IDS = [
  "d4f04efc-7ba7-412c-b7fb-ff063745af39",
  "c19c482e-3280-43a4-b531-8c066477c217",
] as const;
const TARGET_USER_IDS = [
  "a70ae7ad-bffb-44a8-ba26-dd0d1fbb1736",
  "e8c6a29e-8216-441f-adf3-abcac6c87a99",
] as const;
const KEPT_ZZ_IDS = [
  "ced35121-dcc8-439b-ae4d-69270dbf7175",
  "ecc34efd-21d1-4a3c-afdd-480a20eb9367",
] as const;

const CLIENT_SCOPED_TABLES = [
  "action_items",
  "activity_log",
  "alerts",
  "burden_snapshots",
  "carrier_profile_enrichments",
  "carrier_profiles",
  "clearinghouse_records",
  "client_activation_initializations",
  "client_attested_profiles",
  "client_credentials",
  "client_invites",
  "client_playbooks",
  "client_requests",
  "cpdp_cases",
  "crashes",
  "dataq_cases",
  "documents",
  "driver_documents",
  "drivers",
  "fmcsa_ingest_files",
  "inspection_vehicles",
  "inspections",
  "mcs150_updates",
  "reports",
  "score_snapshots",
  "subscriptions",
  "users",
  "vehicle_maintenance",
  "vehicles",
  "violations",
] as const;

const READ_ONLY_BACKUP_TABLES = [
  "bak_ns_activity_log_20260625",
  "bak_ns_burden_snapshots_20260625",
  "bak_ns_carrier_profiles_20260625",
  "bak_ns_client_credentials_20260625",
  "bak_ns_client_invites_20260625",
  "bak_ns_cpdp_cases_20260625",
  "bak_ns_crashes_20260625",
  "bak_ns_dataq_cases_20260625",
  "bak_ns_inspection_vehicles_20260625",
  "bak_ns_inspections_20260625",
  "bak_ns_reports_20260625",
  "bak_ns_score_snapshots_20260625",
  "bak_ns_subscriptions_20260625",
  "bak_ns_users_20260625",
  "bak_ns_violations_20260625",
  "inspections_backup_20260617",
  "violations_backup_20260617",
] as const;

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function countByClient(table: string, clientIds = TARGET_CLIENT_IDS) {
  const result = await service
    .from(table)
    .select("*", { count: "exact", head: true })
    .in("client_id", [...clientIds]);
  if (result.error) {
    throw new Error(`${table} count failed: ${result.error.message}`);
  }
  return result.count ?? 0;
}

async function scopedCounts(tables: readonly string[]) {
  const entries: Array<[string, number]> = [];
  for (const table of tables) {
    entries.push([table, await countByClient(table)]);
  }
  return Object.fromEntries(entries);
}

async function keptProof() {
  const [clients, users] = await Promise.all([
    service
      .from("clients")
      .select("id, name, status, tier")
      .in("id", [...KEPT_ZZ_IDS])
      .order("id"),
    service
      .from("users")
      .select("id, client_id, role")
      .in("client_id", [...KEPT_ZZ_IDS])
      .order("id"),
  ]);
  if (clients.error || users.error) {
    throw new Error(
      `ZZ proof failed: ${clients.error?.message ?? users.error?.message}`
    );
  }
  return { clients: clients.data ?? [], users: users.data ?? [] };
}

async function removeStorageObjects() {
  const { data: documents, error } = await service
    .from("documents")
    .select("storage_path")
    .in("client_id", [...TARGET_CLIENT_IDS])
    .not("storage_path", "is", null);
  if (error) throw new Error(`Document storage inventory failed: ${error.message}`);
  const paths = (documents ?? [])
    .map((row) => row.storage_path as string | null)
    .filter((path): path is string => Boolean(path));
  if (paths.length > 0) {
    const removed = await service.storage.from("documents").remove(paths);
    if (removed.error) {
      throw new Error(`Document storage cleanup failed: ${removed.error.message}`);
    }
  }
  return paths.length;
}

async function main() {
  const targetClients = await service
    .from("clients")
    .select("id, name")
    .in("id", [...TARGET_CLIENT_IDS])
    .order("id");
  if (targetClients.error) throw targetClients.error;
  assert.deepEqual(
    (targetClients.data ?? []).map((row) => row.id).sort(),
    [...TARGET_CLIENT_IDS].sort(),
    "cleanup abort: the two exact TEST—Onboarding clients were not both present"
  );

  const targetUsers = await service
    .from("users")
    .select("id, client_id")
    .in("id", [...TARGET_USER_IDS])
    .order("id");
  if (targetUsers.error) throw targetUsers.error;
  assert.deepEqual(
    (targetUsers.data ?? []).map((row) => row.id).sort(),
    [...TARGET_USER_IDS].sort(),
    "cleanup abort: the two exact synthetic public users were not both present"
  );
  assert.ok(
    (targetUsers.data ?? []).every((row) =>
      TARGET_CLIENT_IDS.includes(row.client_id as (typeof TARGET_CLIENT_IDS)[number])
    ),
    "cleanup abort: a target user is no longer linked to a target client"
  );

  const [before, backupsBefore, zzBefore] = await Promise.all([
    scopedCounts(CLIENT_SCOPED_TABLES),
    scopedCounts(READ_ONLY_BACKUP_TABLES),
    keptProof(),
  ]);
  const userOwnedRequestsBefore = await service
    .from("client_requests")
    .select("id", { count: "exact", head: true })
    .in("created_by", [...TARGET_USER_IDS]);
  if (userOwnedRequestsBefore.error) throw userOwnedRequestsBefore.error;
  assert.deepEqual(
    Object.entries(backupsBefore).filter(([, count]) => count !== 0),
    [],
    "cleanup abort: a read-only backup table contains a target client"
  );

  const storageObjectsRemoved = await removeStorageObjects();

  // activity_log.client_id and users.client_id are SET NULL on client delete;
  // delete them explicitly first so no synthetic record loses its scope.
  const activityByClient = await service
    .from("activity_log")
    .delete()
    .in("client_id", [...TARGET_CLIENT_IDS]);
  if (activityByClient.error) throw activityByClient.error;
  const activityByUser = await service
    .from("activity_log")
    .delete()
    .in("user_id", [...TARGET_USER_IDS]);
  if (activityByUser.error) throw activityByUser.error;

  // A disposable verifier can create a request for a retained test carrier
  // during the browser proof. That row is still synthetic test activity and its
  // NO ACTION created_by FK must be removed before deleting the verifier.
  const requestsByUser = await service
    .from("client_requests")
    .delete()
    .in("created_by", [...TARGET_USER_IDS]);
  if (requestsByUser.error) throw requestsByUser.error;

  // The only direct client_id table without a declared cascade is included
  // explicitly. The current targets have no rows, so this remains narrowly ID-scoped.
  const looseInspectionVehicles = await service
    .from("inspection_vehicles")
    .delete()
    .in("client_id", [...TARGET_CLIENT_IDS]);
  if (looseInspectionVehicles.error) throw looseInspectionVehicles.error;

  const publicUsersDelete = await service
    .from("users")
    .delete()
    .in("id", [...TARGET_USER_IDS]);
  if (publicUsersDelete.error) throw publicUsersDelete.error;

  const clientsDelete = await service
    .from("clients")
    .delete()
    .in("id", [...TARGET_CLIENT_IDS]);
  if (clientsDelete.error) throw clientsDelete.error;

  // The prompt explicitly authorizes removal of these two synthetic Auth users.
  // There were no live sessions at the pre-cleanup audit; deleteUser also removes
  // their identities and refresh-session rows.
  for (const userId of TARGET_USER_IDS) {
    const deleted = await service.auth.admin.deleteUser(userId);
    if (deleted.error) {
      throw new Error(`Synthetic Auth user cleanup failed: ${deleted.error.message}`);
    }
  }

  const [
    after,
    backupsAfter,
    zzAfter,
    clientsAfter,
    usersAfter,
    userOwnedRequestsAfter,
  ] =
    await Promise.all([
      scopedCounts(CLIENT_SCOPED_TABLES),
      scopedCounts(READ_ONLY_BACKUP_TABLES),
      keptProof(),
      service
        .from("clients")
        .select("id", { count: "exact", head: true })
        .in("id", [...TARGET_CLIENT_IDS]),
      service
        .from("users")
        .select("id", { count: "exact", head: true })
        .in("id", [...TARGET_USER_IDS]),
      service
        .from("client_requests")
        .select("id", { count: "exact", head: true })
        .in("created_by", [...TARGET_USER_IDS]),
    ]);
  if (clientsAfter.error || usersAfter.error || userOwnedRequestsAfter.error) {
    throw (
      clientsAfter.error ?? usersAfter.error ?? userOwnedRequestsAfter.error
    );
  }

  assert.equal(clientsAfter.count, 0);
  assert.equal(usersAfter.count, 0);
  assert.equal(userOwnedRequestsAfter.count, 0);
  assert.deepEqual(
    Object.entries(after).filter(([, count]) => count !== 0),
    [],
    "a client-scoped synthetic row survived cleanup"
  );
  assert.deepEqual(backupsAfter, backupsBefore);
  assert.deepEqual(zzAfter, zzBefore, "a retained ZZ carrier or linked user changed");

  const authProof: Record<string, "deleted" | "still_present"> = {};
  for (const userId of TARGET_USER_IDS) {
    const result = await service.auth.admin.getUserById(userId);
    authProof[userId] = result.data.user ? "still_present" : "deleted";
  }
  assert.ok(Object.values(authProof).every((value) => value === "deleted"));

  console.log(
    JSON.stringify(
      {
        targetClientIds: TARGET_CLIENT_IDS,
        targetUserIds: TARGET_USER_IDS,
        before,
        after,
        authUsers: authProof,
        userOwnedRequests: {
          before: userOwnedRequestsBefore.count ?? 0,
          after: userOwnedRequestsAfter.count ?? 0,
        },
        storageObjectsRemoved,
        readOnlyBackupRows: backupsAfter,
        keptZz: zzAfter,
        externalStripeObjectsChanged: 0,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
