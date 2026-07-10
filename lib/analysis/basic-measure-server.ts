import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { computeBurdenFromRows, type BurdenResult, type ViolationRow } from "./basic-measure";

interface ViolationQueryRow {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  inspections: { inspection_date: string | null; state: string | null } | { inspection_date: string | null; state: string | null }[] | null;
}

function flattenInspection(
  inspections: ViolationQueryRow["inspections"]
): { inspection_date: string | null; state: string | null } | null {
  if (Array.isArray(inspections)) return inspections[0] ?? null;
  return inspections;
}

export async function getClientBurden(
  clientId: string,
  adminClient?: SupabaseClient
): Promise<BurdenResult> {
  const supabase = adminClient ?? (await createServiceClient());
  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(clientId, supabase);
  let query = supabase
    .from("violations")
    .select(
      "id, violation_code, violation_description, basic_category, severity_weight, oos_violation, inspections(inspection_date, state)"
    )
    .eq("client_id", clientId);

  query = canonicalInspectionIds.length > 0
    ? query.in("inspection_id", canonicalInspectionIds)
    : query.in("inspection_id", []);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load client BASIC burden: ${error.message}`);
  }

  const rows: ViolationRow[] = ((data ?? []) as ViolationQueryRow[]).map((v) => {
    const inspection = flattenInspection(v.inspections);
    return {
      id: v.id,
      violationCode: v.violation_code ?? "",
      violationDescription: v.violation_description,
      basicCategory: v.basic_category,
      severityWeight: v.severity_weight,
      oosViolation: v.oos_violation ?? false,
      inspectionDate: inspection?.inspection_date ?? null,
      state: inspection?.state ?? null,
    };
  });

  return computeBurdenFromRows(rows);
}
