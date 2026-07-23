import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

export type CanonicalInspectionScope = {
  inspectionIds: string[];
  source: "authenticated" | "public";
};

type InspectionScopeRow = {
  id: string;
  mcmis_inspection_id: string | null;
};

export function selectCanonicalInspectionScope(
  rows: InspectionScopeRow[]
): CanonicalInspectionScope {
  const authenticatedIds = rows
    .filter((row) => row.mcmis_inspection_id !== null)
    .map((row) => row.id);

  if (authenticatedIds.length > 0) {
    return { inspectionIds: authenticatedIds, source: "authenticated" };
  }

  return {
    inspectionIds: rows
      .filter((row) => row.mcmis_inspection_id === null)
      .map((row) => row.id),
    source: "public",
  };
}

/**
 * One inspection layer per client. Authenticated COMPASS detail rows win when
 * present; otherwise the public FMCSA import is the canonical fallback.
 */
export async function getCanonicalInspectionScope(
  clientId: string,
  adminClient?: SupabaseClient
): Promise<CanonicalInspectionScope> {
  const supabase = adminClient ?? (await createServiceClient());
  const rows: InspectionScopeRow[] = [];
  const pageSize = 1_000;
  const countResult = await supabase
    .from("inspections")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (countResult.error) {
    throw new Error(
      `Unable to count canonical inspection scope: ${countResult.error.message}`
    );
  }
  const expectedCount = countResult.count ?? 0;
  while (rows.length < expectedCount) {
    const { data, error } = await supabase
      .from("inspections")
      .select("id, mcmis_inspection_id")
      .eq("client_id", clientId)
      .order("id", { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);

    if (error) {
      throw new Error(
        `Unable to load canonical inspection scope: ${error.message}`
      );
    }
    const page = (data ?? []) as InspectionScopeRow[];
    if (page.length === 0) {
      throw new Error(
        `Unable to load canonical inspection scope: expected ${expectedCount} rows but received ${rows.length}.`
      );
    }
    rows.push(...page);
  }

  return selectCanonicalInspectionScope(rows);
}
