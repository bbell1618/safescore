import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeViolationLookupCode } from "@/lib/fmcsa/inspection-detail-xml";
import type { InspectionDetailLookup } from "@/lib/fmcsa/inspection-detail-xml-types";

type ReferenceRow = {
  violation_code: string;
  basic_category: InspectionDetailLookup["basicCategory"];
  severity_weight: number | null;
  is_scored?: boolean;
};

export type ViolationReferenceLookup = Record<string, InspectionDetailLookup>;

export async function loadViolationReferenceLookup(
  supabase: SupabaseClient
): Promise<ViolationReferenceLookup> {
  const rows: ReferenceRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("fmcsa_violation_reference")
      .select("violation_code, basic_category, severity_weight, is_scored")
      .order("is_scored", { ascending: false })
      .order("severity_weight", { ascending: false, nullsFirst: false })
      .order("violation_code", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ReferenceRow[]));
    if ((data?.length ?? 0) < pageSize) break;
  }

  const lookup: ViolationReferenceLookup = {};
  for (const row of rows) {
    const value: InspectionDetailLookup = {
      basicCategory: row.basic_category ?? null,
      severityWeight: row.severity_weight ?? null,
    };
    lookup[row.violation_code.toUpperCase()] = value;

    const normalized = normalizeViolationLookupCode(row.violation_code);
    lookup[normalized] ??= value;
  }

  return lookup;
}
