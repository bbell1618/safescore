import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";

export const dynamic = "force-dynamic";

/**
 * QF-221: the carrier checks their truck list. One call saves everything they changed:
 * trucks they took off, trucks they added, and the confirmation that the list is right.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const service = serviceClient();
    const now = new Date().toISOString();
    const remove = Array.isArray(body.remove) ? body.remove.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
    const add = Array.isArray(body.add) ? body.add.slice(0, 200) : [];

    if (remove.length) {
      const { error } = await service.from("vehicles").update({ status: "inactive", updated_at: now }).eq("client_id", client.id).in("id", remove);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = add.flatMap((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const unit = cleanString(item.unit, 40);
      const vin = cleanString(item.vin, 17).toUpperCase();
      const make = cleanString(item.make, 60);
      const plate = cleanString(item.plate, 12).toUpperCase();
      const year = Number(item.year);
      if (!unit && !vin && !plate) return [];
      return [{
        client_id: client.id, unit_number: unit || null, vin: vin || null, make: make || null, license_plate: plate || null,
        year: Number.isInteger(year) && year >= 1980 && year <= new Date().getFullYear() + 1 ? year : null,
        status: "active", carrier_confirmed_at: now, updated_at: now,
      }];
    });
    if (rows.length) {
      const { error } = await service.from("vehicles").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const note = cleanString(body.note, 600);
    const { count: active } = await service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "active");
    if (!active && !note) return NextResponse.json({ error: "Add at least one truck, or tell us in the note why there are none." }, { status: 400 });

    const { error: confirmError } = await service.from("vehicles").update({ carrier_confirmed_at: now }).eq("client_id", client.id).eq("status", "active");
    if (confirmError) return NextResponse.json({ error: confirmError.message }, { status: 500 });
    const { error } = await service.from("clients").update({ trucks_confirmed_at: now, trucks_note: note || null, fleet_size: active || null }).eq("id", client.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlanEvent(client.id, "carrier_truck_list_confirmed", `Carrier confirmed the truck list: ${active ?? 0} trucks (${rows.length} added, ${remove.length} taken off)`, {
      active: active ?? 0, added: rows.length, removed: remove.length, note: note || null,
    });
    return NextResponse.json({ ok: true, trucks: active ?? 0 });
  });
}
