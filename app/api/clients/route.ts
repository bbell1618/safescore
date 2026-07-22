import { createServiceClient } from "@/lib/supabase/server";
import { getCarrier } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";

// Normalize FMCSA date strings to ISO YYYY-MM-DD for Postgres date column.
// FMCSA commonly returns MMDDYYYY or MM/DD/YYYY. Returns null on any failure.
function parseFmcsaDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    // MMDDYYYY (8 digits, no separator)
    if (/^\d{8}$/.test(dateStr)) {
      const m = dateStr.slice(0, 2);
      const d = dateStr.slice(2, 4);
      const y = dateStr.slice(4, 8);
      return `${y}-${m}-${d}`;
    }
    // MM/DD/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [m, d, y] = dateStr.split("/");
      return `${y}-${m}-${d}`;
    }
    // Try generic Date parsing as a last resort (handles ISO etc.)
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      dot_number,
      mc_number,
      contact_email,
      contact_name,
      driver_count,
      tier,
      geia_client,
      status,
      city,
      state,
      fleet_size,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!dot_number || typeof dot_number !== "string" || !dot_number.trim()) {
      return NextResponse.json({ error: "DOT number is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("clients")
      .select("id, name")
      .eq("dot_number", dot_number.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `A client with DOT number ${dot_number.trim()} already exists (${existing.name}).` },
        { status: 409 }
      );
    }

    const parsedDriverCount =
      driver_count !== undefined && driver_count !== null && driver_count !== ""
        ? Number(driver_count)
        : null;
    const parsedFleetSize =
      fleet_size !== undefined && fleet_size !== null && fleet_size !== ""
        ? Number(fleet_size)
        : null;
    const clientStatus = status === "prospect" ? "prospect" : "onboarding";

    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        dot_number: dot_number.trim(),
        mc_number: mc_number?.trim() || null,
        email: contact_email?.trim() || null,
        primary_contact: contact_name?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        fleet_size: parsedFleetSize !== null && Number.isFinite(parsedFleetSize) ? parsedFleetSize : null,
        driver_count: parsedDriverCount !== null && Number.isFinite(parsedDriverCount) ? parsedDriverCount : null,
        tier: tier ?? "monitor",
        status: clientStatus,
        geia_client: Boolean(geia_client),
      })
      .select("id, name, dot_number")
      .single();

    if (insertError || !client) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create client" },
        { status: 500 }
      );
    }

    // Synchronously fetch and cache carrier profile from FMCSA.
    // Awaited before returning so it completes reliably (fire-and-forget is
    // not guaranteed to finish in serverless environments after response is sent).
    try {
      const carrier = await getCarrier(client.dot_number);
      const { error: cpErr } = await supabase.from("carrier_profiles").insert({
        client_id: client.id,
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
      });
      if (cpErr) {
        console.error(
          `Carrier profile insert failed for DOT ${client.dot_number}:`,
          cpErr.message
        );
      } else {
        console.log(`Carrier profile cached for DOT ${client.dot_number}`);
      }
    } catch (err) {
      console.error(
        `Carrier profile fetch failed for DOT ${client.dot_number} (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }

    return NextResponse.json({ success: true, client });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
