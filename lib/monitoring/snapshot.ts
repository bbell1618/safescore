import "server-only";

import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { createServiceClient } from "@/lib/supabase/server";

type SnapshotPerBasic = {
  basic_category: string;
  violation_count: number;
  weighted_points: number;
};

export type BurdenSnapshotResult =
  | {
      status: "inserted";
      snapshotDate: string;
      totalPoints: number;
      previousSnapshotDate: string | null;
    }
  | {
      status: "unchanged";
      snapshotDate: string;
      totalPoints: number;
      previousSnapshotDate: string;
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
): Promise<BurdenSnapshotResult> {
  const supabase = await createServiceClient();
  const burden = await getClientBurden(clientId);
  const snapshotDate = todayIsoDate();

  const perBasic: SnapshotPerBasic[] = burden.perBasic.map((item) => ({
    basic_category: item.basicCategory,
    violation_count: item.violationCount,
    weighted_points: item.weightedPoints,
  }));

  const { data: canonicalInspections, error: canonicalError } = await supabase
    .from("inspections")
    .select("id")
    .eq("client_id", clientId)
    .not("mcmis_inspection_id", "is", null);

  if (canonicalError) {
    throw new Error(`Unable to load canonical inspections: ${canonicalError.message}`);
  }

  const canonicalInspectionIds = (canonicalInspections ?? []).map((row) => row.id as string);
  const hasCanonicalInspections = canonicalInspectionIds.length > 0;

  const violationCountQuery = supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  const scopedViolationCountQuery = hasCanonicalInspections
    ? violationCountQuery.in("inspection_id", canonicalInspectionIds)
    : violationCountQuery;

  const oosCountQuery = supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("oos_violation", true);
  const scopedOosCountQuery = hasCanonicalInspections
    ? oosCountQuery.in("inspection_id", canonicalInspectionIds)
    : oosCountQuery;

  const [violationCount, inspectionCount, crashCount, oosCount] = await Promise.all([
    checkedCount(await scopedViolationCountQuery, "violations"),
    hasCanonicalInspections
      ? canonicalInspectionIds.length
      : checkedCount(
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
    checkedCount(await scopedOosCountQuery, "OOS violations"),
  ]);

  const { data: latestSnapshot, error: latestError } = await supabase
    .from("burden_snapshots")
    .select(
      "snapshot_date, total_points, violation_count, inspection_count, crash_count, oos_count"
    )
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(`Unable to load latest burden snapshot: ${latestError.message}`);
  }

  const unchanged =
    latestSnapshot &&
    latestSnapshot.total_points === burden.totalPoints &&
    latestSnapshot.violation_count === violationCount &&
    latestSnapshot.inspection_count === inspectionCount &&
    latestSnapshot.crash_count === crashCount &&
    latestSnapshot.oos_count === oosCount;

  if (unchanged) {
    return {
      status: "unchanged",
      snapshotDate,
      totalPoints: burden.totalPoints,
      previousSnapshotDate: latestSnapshot.snapshot_date,
    };
  }

  const { error } = await supabase
    .from("burden_snapshots")
    .insert({
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
    });

  if (error) throw new Error(`Unable to capture burden snapshot: ${error.message}`);

  return {
    status: "inserted",
    snapshotDate,
    totalPoints: burden.totalPoints,
    previousSnapshotDate: latestSnapshot?.snapshot_date ?? null,
  };
}
