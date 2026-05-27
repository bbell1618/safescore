import { createServiceClient } from "@/lib/supabase/server";
import { getCarrier } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, dot_number, mc_number, contact_email, contact_name, driver_count, tier } = body;

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

    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        dot_number: dot_number.trim(),
        mc_number: mc_number?.trim() || null,
        email: contact_email?.trim() || null,
        primary_contact: contact_name?.trim() || null,
        driver_count: driver_count ? Number(driver_count) : null,
        tier: tier ?? "monitor",
        status: "onboarding",
        geia_client: true,
      })
      .select("id, name, dot_number")
      .single();

    if (insertError || !client) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create client" },
        { status: 500 }
      );
    }

    // Fire-and-forget: fetch carrier profile from FMCSA in background (non-blocking)
    void (async () => {
      try {
        const carrier = await getCarrier(client.dot_number);
        await supabase.from("carrier_profiles").delete().eq("client_id", client.id);
        await supabase.from("carrier_profiles").insert({
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
          mcs150_date: carrier.mcs150FormDate ?? null,
          mcs150_mileage: carrier.mcs150Mileage ?? null,
          safety_rating: carrier.safetyRating ?? null,
          raw_api_response: carrier as unknown as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Auto carrier profile fetch failed (non-fatal):", err);
      }
    })();

    return NextResponse.json({ success: true, client });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
