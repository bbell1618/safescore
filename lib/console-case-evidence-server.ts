import "server-only";
import { createClient } from "@/lib/supabase/server";
export async function loadCaseEvidenceCounts(dataqIds: string[], cpdpIds: string[]) {
  const supabase = await createClient();
  const [dataq, cpdp] = await Promise.all([
    dataqIds.length ? supabase.from("dataq_evidence").select("case_id,storage_path").in("case_id", dataqIds) : Promise.resolve({ data: [], error: null }),
    cpdpIds.length ? supabase.from("cpdp_evidence").select("case_id,storage_path").in("case_id", cpdpIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const counts: Record<string, number> = {};
  for (const [kind, result] of [["dataq", dataq], ["cpdp", cpdp]] as const) {
    if (result.error) throw new Error(`Unable to load ${kind} evidence counts: ${result.error.message}`);
    for (const row of result.data ?? []) if (row.storage_path) counts[`${kind}-${row.case_id}`] = (counts[`${kind}-${row.case_id}`] ?? 0) + 1;
  }
  return counts;
}
