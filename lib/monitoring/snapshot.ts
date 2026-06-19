import "server-only";

import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { createServiceClient } from "@/lib/supabase/server";

type SnapshotPerBasic = {
  basic_category: string;
  violation_count: number;
  weighted_points: number;
};

function checkedCount(
  result: { count: number | null; error: { message: string } | null },
  label: string
) {
  const { count, error } = result;
  if (error) throw new Error(`Unable to count ${label}: ${error.message}`);
  return count ?? 0;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function captureBurdenSnapshot(
  clientId: string,
  source: string = "ingest"
): Promise<{ snapshotDate: string; totalPoints: number }> {
  const supabase = await createServiceClient();
  const burden = await getClientBurden(clientId);
  const snapshotDate = todayIsoDate();

  const perBasic: SnapshotPerBasic[] = burden.perBasic.map((item) => ({
    basic_category: item.basicCategory,
    violation_count: item.violationCount,
    weighted_points: item.weightedPoints,
  }));

  const [violationCount, inspectionCount, crashCount, oosCount] = await Promise.all([
    checkedCount(
      await supabase
        .from("violations")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      "violations"
    ),
    checkedCount(
      await supabase
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      "inspections"
    ),
    checkedCount(
      await supabase
        .from("crashes")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      "crashes"
    ),
    checkedCount(
      await supabase
        .from("violations")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("oos_violation", true),
      "OOS violations"
    ),
  ]);

  const { error } = await supabase
    .from("burden_snapshots")
    .upsert(
      {
        client_id: clientId,
        snapshot_date: snapshotDate,
        captured_at: new Date().toISOString(),
        source,
        total_points: burden.totalPoints,
        per_basic: perBasic,
        violation_count: violationCount,
        inspection_count: inspectionCount,
        crash_count: crashCount,
        oos_count: oosCount,
      },
      { onConflict: "client_id,snapshot_date" }
    );

  if (error) throw new Error(`Unable to capture burden snapshot: ${error.message}`);

  return { snapshotDate, totalPoints: burden.totalPoints };
}
