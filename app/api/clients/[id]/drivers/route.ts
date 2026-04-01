import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, cdl_number, cdl_state, cdl_expiry, medical_cert_expiry } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Driver name is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data: newRow, error } = await supabase
      .from("drivers")
      .insert({
        client_id: id,
        full_name: name,
        cdl_number: cdl_number || null,
        cdl_state: cdl_state || null,
        cdl_expiry: cdl_expiry || null,
        medical_cert_expiry: medical_cert_expiry || null,
        status: "active",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Insert driver error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, driverId: newRow?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
