import { createServiceClient } from "@/lib/supabase/server";
import { getCarrier } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";

// Normalize FMCSA date strings to ISO YYYY-MM-DD for Postgres date column.
function parseFmcsaDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    if (/^\d{8}$/.test(dateStr)) {
      const m = dateStr.slice(0, 2);
      const d = dateStr.slice(2, 4);
      const y = dateStr.slice(4, 8);
      return `${y}-${m}-${d}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [m, d, y] = dateStr.split("/");
      return `${y}-${m}-${d}`;
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
  } catch {
    return null;
  }
}

// GET — return cached carrier profile from DB
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: profile } = await supabase
    .from("carrier_profiles")
    .select("*")
    .eq("client_id", id)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ profile: profile ?? null });
}

// POST — fetch fresh data from FMCSA and upsert into DB
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, dot_number")
    .eq("id", id)
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  try {
    const carrier = await getCarrier(client.dot_number);

    // Delete old profile rows for this client before inserting fresh one
    await supabase.from("carrier_profiles").delete().eq("client_id", id);

    const { data: profile, error: insertError } = await supabase
      .from("carrier_profiles")
      .insert({
        client_id: id,
        dot_number: client.dot_number,
        mc_number: carrier.mcNumber,
        legal_name: carrier.legalName,
        dba_name: carrier.dbaName,
        address: [carrier.phyStreet, carrier.phyCity, carrier.phyState, carrier.phyZip]
          .filter(Boolean)
          .join(", "),
        power_units: carrier.totalPowerUnits ?? null,
        drivers: carrier.totalDrivers ?? null,
        mcs150_date: parseFmcsaDate(carrier.mcs150FormDate),
        mcs150_mileage: carrier.mcs150Mileage ?? null,
        safety_rating: carrier.safetyRating ?? null,
        raw_api_response: carrier as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (insertError || !profile) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to store carrier profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
