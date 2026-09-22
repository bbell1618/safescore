import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillableDriverCount, BillableDriverSource } from "./billable-drivers-types";

export type { BillableDriverCount, BillableDriverSource } from "./billable-drivers-types";

function validCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

/** Reads every billing source. A failed read must not silently lower a bill. */
export async function getBillableDriverCount(
  supabase: SupabaseClient,
  clientId: string
): Promise<BillableDriverCount> {
  const [client, fmcsa, attested, unattested, roster] = await Promise.all([
    supabase.from("clients").select("driver_count").eq("id", clientId).maybeSingle(),
    supabase.from("carrier_profiles").select("drivers, mcs150_date")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle(),
    supabase.from("client_attested_profiles").select("drivers, attested_at, updated_at")
      .eq("client_id", clientId).not("attested_at", "is", null)
      .order("attested_at", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle(),
    supabase.from("client_attested_profiles").select("drivers, attested_at, updated_at")
      .eq("client_id", clientId).is("attested_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle(),
    // Same official active-driver predicate as lib/compliance/expiration-sweep.ts.
    // Pending roster submissions are not yet trusted driver records.
    supabase.from("drivers").select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "active")
      .not("approved_at", "is", null),
  ]);

  for (const [source, result] of [
    ["client_stated", client], ["fmcsa_mcs150", fmcsa],
    ["attested", attested], ["attested (updated_at fallback)", unattested],
    ["active_roster", roster],
  ] as const) {
    if (result.error) {
      throw new Error(`Unable to load billable drivers from ${source}: ${result.error.message}`);
    }
  }

  // Two bounded queries implement latest by COALESCE(attested_at, updated_at),
  // including an un-attested row updated after the latest dated attestation.
  const profile = [attested.data, unattested.data]
    .filter((row) => row !== null)
    .sort((a, b) => {
      const aTime = Date.parse(a.attested_at ?? a.updated_at ?? "");
      const bTime = Date.parse(b.attested_at ?? b.updated_at ?? "");
      return (Number.isNaN(bTime) ? -Infinity : bTime) -
        (Number.isNaN(aTime) ? -Infinity : aTime);
    })[0];

  const sources: BillableDriverCount["sources"] = [
    { source: "client_stated", value: validCount(client.data?.driver_count), asOf: null },
    { source: "fmcsa_mcs150", value: validCount(fmcsa.data?.drivers), asOf: fmcsa.data?.mcs150_date ?? null },
    { source: "attested", value: validCount(profile?.drivers), asOf: profile?.attested_at ?? null },
    { source: "active_roster", value: validCount(roster.count), asOf: null },
  ];
  const priority: BillableDriverSource[] = ["fmcsa_mcs150", "attested", "active_roster", "client_stated"];
  let billable: number | null = null;
  let winningSource: BillableDriverSource | null = null;
  for (const source of priority) {
    const value = sources.find((candidate) => candidate.source === source)!.value;
    if (value !== null && (billable === null || value > billable)) {
      billable = value;
      winningSource = source;
    }
  }
  return { billable, winningSource, sources };
}
