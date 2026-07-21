import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

type SnapshotPerBasic = {
  basic_category: string;
  violation_count: number;
  weighted_points: number;
};

export type BurdenSnapshotMetrics = {
  totalPoints: number;
  violationCount: number;
  inspectionCount: number;
  crashCount: number;
};

export type LatestBurdenSnapshot = BurdenSnapshotMetrics & {
  capturedAt: string;
};

export type BurdenSnapshotDecision = {
  shouldInsert: boolean;
  reason: "initial" | "metrics_changed" | "max_age" | "unchanged";
  changedFields: Array<keyof BurdenSnapshotMetrics>;
  ageMs: number | null;
};

export const BURDEN_SNAPSHOT_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Pure snapshot policy used by both the scheduled and interactive refresh paths.
 * OOS count is still stored for reporting, but it is deliberately not one of the
 * four fields that independently mints a new snapshot.
 */
export function decideBurdenSnapshot({
  current,
  latest,
  now,
}: {
  current: BurdenSnapshotMetrics;
  latest: LatestBurdenSnapshot | null;
  now: Date;
}): BurdenSnapshotDecision {
  if (!latest) {
    return {
      shouldInsert: true,
      reason: "initial",
      changedFields: [],
      ageMs: null,
    };
  }

  const nowMs = now.getTime();
  const capturedAtMs = Date.parse(latest.capturedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(capturedAtMs)) {
    throw new Error("Snapshot policy requires valid current and captured-at timestamps");
  }

  const metricFields: Array<keyof BurdenSnapshotMetrics> = [
    "totalPoints",
    "violationCount",
    "inspectionCount",
    "crashCount",
  ];
  const changedFields = metricFields.filter(
    (field) => current[field] !== latest[field]
  );
  const ageMs = nowMs - capturedAtMs;

  if (changedFields.length > 0) {
    return {
      shouldInsert: true,
      reason: "metrics_changed",
      changedFields,
      ageMs,
    };
  }

  if (ageMs >= BURDEN_SNAPSHOT_MAX_AGE_MS) {
    return {
      shouldInsert: true,
      reason: "max_age",
      changedFields: [],
      ageMs,
    };
  }

  return {
    shouldInsert: false,
    reason: "unchanged",
    changedFields: [],
    ageMs,
  };
}

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

function todayIsoDate(now: Date) {
  return now.toISOString().slice(0, 10);
}

export async function captureBurdenSnapshot(
  clientId: string,
  source: string = "ingest",
  adminClient?: SupabaseClient
): Promise<BurdenSnapshotResult> {
  const supabase = adminClient ?? (await createServiceClient());
  const burden = await getClientBurden(clientId, supabase);
  const now = new Date();
  const snapshotDate = todayIsoDate(now);

  const perBasic: SnapshotPerBasic[] = burden.perBasic.map((item) => ({
    basic_category: item.basicCategory,
    violation_count: item.violationCount,
    weighted_points: item.weightedPoints,
  }));

  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(clientId, supabase);

  const violationCountQuery = supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  const scopedViolationCountQuery = canonicalInspectionIds.length > 0
    ? violationCountQuery.in("inspection_id", canonicalInspectionIds)
    : violationCountQuery.in("inspection_id", []);

  const oosCountQuery = supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("oos_violation", true);
  const scopedOosCountQuery = canonicalInspectionIds.length > 0
    ? oosCountQuery.in("inspection_id", canonicalInspectionIds)
    : oosCountQuery.in("inspection_id", []);

  const [violationCount, inspectionCount, crashCount, oosCount] = await Promise.all([
    checkedCount(await scopedViolationCountQuery, "violations"),
    canonicalInspectionIds.length,
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
      "snapshot_date, captured_at, total_points, violation_count, inspection_count, crash_count, oos_count"
    )
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(`Unable to load latest burden snapshot: ${latestError.message}`);
  }

  const decision = decideBurdenSnapshot({
    current: {
      totalPoints: burden.totalPoints,
      violationCount,
      inspectionCount,
      crashCount,
    },
    latest: latestSnapshot
      ? {
          capturedAt: latestSnapshot.captured_at,
          totalPoints: latestSnapshot.total_points,
          violationCount: latestSnapshot.violation_count,
          inspectionCount: latestSnapshot.inspection_count,
          crashCount: latestSnapshot.crash_count,
        }
      : null,
    now,
  });

  if (!decision.shouldInsert && latestSnapshot) {
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
      captured_at: now.toISOString(),
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
