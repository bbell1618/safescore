import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getClientBurden } from "../lib/analysis/basic-measure-server";
import { getCanonicalInspectionScope } from "../lib/fmcsa/canonical-inspection-scope";

loadEnvConfig(process.cwd());

const clientId = process.argv[2];
if (!clientId) {
  throw new Error("Usage: npx tsx scripts/verify-phase1-pipeline.ts <client-id>");
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const scope = await getCanonicalInspectionScope(clientId, supabase);
  const burden = await getClientBurden(clientId, supabase);
  const [inspectionResult, violationResult, snapshotResult] = await Promise.all([
    supabase
      .from("inspections")
      .select("id", { count: "exact", head: true })
      .in("id", scope.inspectionIds),
    supabase
      .from("violations")
      .select("id", { count: "exact", head: true })
      .in("inspection_id", scope.inspectionIds),
    supabase
      .from("burden_snapshots")
      .select("snapshot_date, source, total_points, inspection_count, violation_count, crash_count, oos_count")
      .eq("client_id", clientId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  for (const result of [inspectionResult, violationResult, snapshotResult]) {
    if (result.error) throw result.error;
  }

  console.log(
    JSON.stringify(
      {
        scope: { source: scope.source, inspectionCount: inspectionResult.count ?? 0 },
        violationCount: violationResult.count ?? 0,
        burden: {
          totalPoints: burden.totalPoints,
          scoredViolationCount: burden.perBasic.reduce(
            (sum, item) => sum + item.violationCount,
            0
          ),
          perBasic: burden.perBasic,
        },
        latestSnapshot: snapshotResult.data,
      },
      null,
      2
    )
  );
}

void main();
