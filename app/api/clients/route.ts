import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, dot_number, mc_number, contact_email, tier } = body;

    // Validate required fields
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!dot_number || typeof dot_number !== "string" || !dot_number.trim()) {
      return NextResponse.json({ error: "DOT number is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Check for duplicate DOT number
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

    // Insert new client
    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        dot_number: dot_number.trim(),
        mc_number: mc_number?.trim() || null,
        email: contact_email?.trim() || null,
        tier: tier ?? "monitor",
        status: "active",
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

    return NextResponse.json({ success: true, client });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
