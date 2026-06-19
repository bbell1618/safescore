import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export interface SnapshotPerBasic {
  basic_category: string;
  violation_count: number;
  weighted_points: number;
}

export interface SnapshotRow {
  id: string;
  client_id: string;
  snapshot_date: string;
  captured_at: string;
  source: string;
  total_points: number;
  per_basic: SnapshotPerBasic[];
  violation_count: number;
  inspection_count: number;
  crash_count: number;
  oos_count: number;
  notes: string | null;
}

export interface BurdenDiff {
  totalPointsDelta: number;
  violationCountDelta: number;
  oosCountDelta: number;
  inspectionCountDelta: number;
  crashCountDelta: number;
  perBasicDeltas: Array<{
    basicCategory: string;
    pointsDelta: number;
    countDelta: number;
  }>;
}

export async function getRecentSnapshots(clientId: string, n = 2): Promise<SnapshotRow[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("burden_snapshots")
    .select(
      "id, client_id, snapshot_date, captured_at, source, total_points, per_basic, violation_count, inspection_count, crash_count, oos_count, notes"
    )
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(n);

  if (error) throw new Error(`Unable to load burden snapshots: ${error.message}`);

  return ((data ?? []) as SnapshotRow[]).map((row) => ({
    ...row,
    per_basic: Array.isArray(row.per_basic) ? row.per_basic : [],
  }));
}

export function diffSnapshots(current: SnapshotRow, previous: SnapshotRow): BurdenDiff {
  const currentByBasic = new Map(
    current.per_basic.map((item) => [item.basic_category, item])
  );
  const previousByBasic = new Map(
    previous.per_basic.map((item) => [item.basic_category, item])
  );
  const basicCategories = new Set([
    ...currentByBasic.keys(),
    ...previousByBasic.keys(),
  ]);

  const perBasicDeltas = [...basicCategories]
    .sort()
    .map((basicCategory) => {
      const currentItem = currentByBasic.get(basicCategory);
      const previousItem = previousByBasic.get(basicCategory);
      return {
        basicCategory,
        pointsDelta:
          (currentItem?.weighted_points ?? 0) - (previousItem?.weighted_points ?? 0),
        countDelta:
          (currentItem?.violation_count ?? 0) - (previousItem?.violation_count ?? 0),
      };
    });

  return {
    totalPointsDelta: current.total_points - previous.total_points,
    violationCountDelta: current.violation_count - previous.violation_count,
    oosCountDelta: current.oos_count - previous.oos_count,
    inspectionCountDelta: current.inspection_count - previous.inspection_count,
    crashCountDelta: current.crash_count - previous.crash_count,
    perBasicDeltas,
  };
}
