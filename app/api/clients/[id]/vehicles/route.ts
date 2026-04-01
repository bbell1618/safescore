import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { unit_number, vin, make, year, license_plate } = body;

    const supabase = await createServiceClient();

    const { data: newRow, error } = await supabase
      .from("vehicles")
      .insert({
        client_id: id,
        unit_number: unit_number || null,
        vin: vin || null,
        make: make || null,
        year: year ? Number(year) : null,
        license_plate: license_plate || null,
        status: "active",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Insert vehicle error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, vehicleId: newRow?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
