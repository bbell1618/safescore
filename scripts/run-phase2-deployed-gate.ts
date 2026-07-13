import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(/\/$/, "");
const syntheticName = "TEST\u2014Acme Freight Lines";
const syntheticDot = "0000001";
const staffEmail = "brandonbell@goldenerainsurance.com";

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: existingClient, error: findError } = await service
    .from("clients")
    .select("id, name")
    .eq("dot_number", syntheticDot)
    .maybeSingle();
  if (findError) throw findError;
  if (existingClient && existingClient.name !== syntheticName) {
    throw new Error(`DOT ${syntheticDot} is already assigned to a different client`);
  }

  let client = existingClient;
  if (!client) {
    const { data, error } = await service
      .from("clients")
      .insert({ name: syntheticName, dot_number: syntheticDot, status: "onboarding" })
      .select("id, name")
      .single();
    if (error || !data) throw error ?? new Error("Synthetic client creation returned no row");
    client = data;
  }

  const { cookie, accessToken } = await getStaffCookie();
  const fixtureRoot = resolve(process.cwd(), "scripts", "fixtures", "fmcsa");
  const fixtures = [
    { filename: "all-basics.csv", type: "text/csv" },
    { filename: "inspection-detail.xml", type: "application/xml" },
  ];

  const routeResults: Record<string, unknown[]> = {};
  for (const fixture of fixtures) {
    const content = await readFile(resolve(fixtureRoot, fixture.filename));
    routeResults[fixture.filename] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const form = new FormData();
      form.set("clientId", client.id);
      form.set("dotNumber", syntheticDot);
      form.set("file", new File([content], fixture.filename, { type: fixture.type }));
      const response = await fetch(`${baseUrl}/api/analysis/ingest-detail`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`${fixture.filename} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
      }
      routeResults[fixture.filename].push(body);
    }
  }

  const [registry, snapshot, inspection] = await Promise.all([
    service
      .from("fmcsa_ingest_files")
      .select("file_hash, ingest_kind, filename, parsed_summary")
      .eq("client_id", client.id)
      .order("ingest_kind"),
    service
      .from("score_snapshots")
      .select("snapshot_date, source, source_file_hash, official_basics, unsafe_driving_measure, unsafe_driving_pct, unsafe_driving_alert, vehicle_maint_measure, vehicle_maint_pct, vehicle_maint_alert, crash_indicator_measure, crash_indicator_pct, crash_indicator_alert")
      .eq("client_id", client.id)
      .eq("snapshot_date", "2026-07-13")
      .single(),
    service
      .from("inspections")
      .select("id, mcmis_inspection_id, report_number, inspection_date, state, level, location_text, total_violations, oos_violations")
      .eq("client_id", client.id)
      .eq("mcmis_inspection_id", "990000001")
      .single(),
  ]);
  for (const result of [registry, snapshot, inspection]) {
    if (result.error) throw result.error;
  }
  if (!inspection.data) throw new Error("Synthetic inspection query returned no row");

  const [violation, vehicle] = await Promise.all([
    service
      .from("violations")
      .select("violation_code, violation_description, basic_category, severity_weight, time_weight, oos_violation, citation_number, citation_result")
      .eq("inspection_id", inspection.data.id)
      .single(),
    service
      .from("inspection_vehicles")
      .select("unit_number, unit_type, make, vin, license_plate, license_state, iep_dot")
      .eq("inspection_id", inspection.data.id)
      .single(),
  ]);
  if (violation.error) throw violation.error;
  if (vehicle.error) throw vehicle.error;

  const { error: signOutError } = await service.auth.admin.signOut(accessToken, "local");
  if (signOutError) throw signOutError;

  console.log(
    JSON.stringify(
      {
        syntheticClientId: client.id,
        routeResults,
        database: {
          registry: registry.data,
          snapshot: snapshot.data,
          inspection: inspection.data,
          violation: violation.data,
          vehicle: vehicle.data,
        },
      },
      null,
      2
    )
  );
}

async function getStaffCookie() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: staffEmail,
    options: { redirectTo: `${baseUrl}/auth/callback?next=/console` },
  });
  if (error || !data.properties?.hashed_token) {
    throw error ?? new Error("Could not create the short-lived deployed-route verification token");
  }

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const { data: verification, error: verificationError } = await authClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verificationError || !verification.session) {
    throw verificationError ?? new Error("Verification token did not produce a session");
  }

  const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${stringToBase64URL(JSON.stringify(verification.session))}`;
  const cookie = createChunks(storageKey, encoded)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  return { cookie, accessToken: verification.session.access_token };
}

void main();
