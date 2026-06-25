import { createServiceClient } from "@/lib/supabase/server";
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

export async function getClientBurden(clientId: string): Promise<BurdenResult> {
  const supabase = await createServiceClient();
  const { data: canonicalInspections, error: canonicalError } = await supabase
    .from("inspections")
    .select("id")
    .eq("client_id", clientId)
    .not("mcmis_inspection_id", "is", null);

  if (canonicalError) {
    throw new Error(`Unable to load canonical inspections: ${canonicalError.message}`);
  }

  const canonicalInspectionIds = (canonicalInspections ?? []).map((row) => row.id as string);
  let query = supabase
    .from("violations")
    .select(
      "id, violation_code, violation_description, basic_category, severity_weight, oos_violation, inspections(inspection_date, state)"
    )
    .eq("client_id", clientId);

  if (canonicalInspectionIds.length > 0) {
    query = query.in("inspection_id", canonicalInspectionIds);
  }

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
