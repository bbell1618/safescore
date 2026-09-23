import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPublicBasicMeasures, publicBasicProfileUrl } from "./public-basic-measures";

// Initial rollout is explicitly approved for this client. Other clients stay opt-in.
export const PUBLIC_BASIC_ROLLOUT_CLIENT = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

export type PublicBasicSaveResult = {
  status: "inserted" | "already_present" | "older_than_saved";
  clientId: string;
  smsRunDate: string;
  rowId: string;
};

/** Append a dated public release. Never update/delete a stored release, including on retries. */
export async function savePublicBasicMeasures(
  service: SupabaseClient,
  clientId: string,
  dotNumber: string,
  capturedBy: string,
  load = fetchPublicBasicMeasures,
): Promise<PublicBasicSaveResult> {
  publicBasicProfileUrl(dotNumber);
  const client = await service.from("clients").select("id, dot_number").eq("id", clientId).single();
  if (client.error) throw new Error(`Unable to verify BASIC client: ${client.error.message}`);
  if (!client.data || client.data.dot_number !== dotNumber) throw new Error("Public BASIC source does not match the stored client USDOT");
  const release = await load(dotNumber);
  if (release.dotNumber !== dotNumber || release.sourceUrl !== publicBasicProfileUrl(dotNumber)) throw new Error("Public BASIC response belongs to a different carrier");
  if (release.currentness !== "current") throw new Error(`Public BASIC release ${release.smsRunDate} is stale; obtain the current authenticated export`);
  const latest = await service.from("basic_measure_releases").select("id, sms_run_date")
    .eq("client_id", clientId).order("sms_run_date", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error(`Unable to load latest BASIC release: ${latest.error.message}`);
  if (latest.data && latest.data.sms_run_date > release.smsRunDate) {
    return { status: "older_than_saved", clientId, smsRunDate: release.smsRunDate, rowId: latest.data.id };
  }
  const existingQuery = () => service.from("basic_measure_releases").select("id")
    .eq("client_id", clientId).eq("sms_run_date", release.smsRunDate).eq("source", "public_sms_profile").maybeSingle();
  const existing = await existingQuery();
  if (existing.error) throw new Error(`Unable to check stored public BASIC release: ${existing.error.message}`);
  if (existing.data) return { status: "already_present", clientId, smsRunDate: release.smsRunDate, rowId: existing.data.id };
  const saved = await service.from("basic_measure_releases").insert({
    client_id: clientId, dot_number: dotNumber, sms_run_date: release.smsRunDate,
    source: "public_sms_profile", source_url: release.sourceUrl,
    measures: release.measures, captured_by: capturedBy,
    notes: "Public SMS release. Private measures, percentiles, alerts and counts remain unknown. Existing releases are never overwritten.",
  }).select("id").single();
  if (saved.error?.code === "23505") {
    const concurrent = await existingQuery();
    if (concurrent.error) throw new Error(`Unable to verify concurrent BASIC release: ${concurrent.error.message}`);
    if (concurrent.data) return { status: "already_present", clientId, smsRunDate: release.smsRunDate, rowId: concurrent.data.id };
  }
  if (saved.error || !saved.data) throw new Error(`Unable to append public BASIC release: ${saved.error?.message ?? "no saved row returned"}`);
  return { status: "inserted", clientId, smsRunDate: release.smsRunDate, rowId: saved.data.id };
}
