import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { syncSummary, syncVehiclesToClientFile } from "@/lib/autopilot/client-file-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * QF-223: the carrier saves their whole truck and trailer list in one go from the one-page list.
 * Rows with an id are edits (or "we no longer run this"); rows without one are new.
 * Saving confirms every unit left on the list, then updates the agency client file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as { rows?: unknown; note?: unknown };
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 800) as Array<Record<string, unknown>> : null;
    if (!rows) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const service = serviceClient();
    const now = new Date().toISOString();
    const thisYear = new Date().getFullYear();

    const { data: existing, error: readError } = await service.from("vehicles").select("id").eq("client_id", client.id).eq("status", "active");
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    const known = new Set((existing ?? []).map((r) => r.id as string));

    const edits: Array<PromiseLike<{ error: { message: string } | null }>> = [];
    const adds: Array<Record<string, unknown>> = [];
    let removed = 0;
    for (const row of rows) {
      const id = typeof row.id === "string" && known.has(row.id) ? row.id : null;
      const active = row.active !== false;
      if (id && !active) {
        edits.push(service.from("vehicles").update({ status: "inactive", updated_at: now }).eq("id", id).eq("client_id", client.id));
        removed += 1;
        continue;
      }
      if (!active) continue;
      const unit = cleanString(row.unit_number, 40);
      const vin = cleanString(row.vin, 17).toUpperCase().replace(/\s+/g, "");
      const plate = cleanString(row.license_plate, 12).toUpperCase();
      if (!unit && !vin && !plate) {
        if (id) return NextResponse.json({ error: "Every truck needs a unit number, a VIN or a plate. Untick any you no longer run instead of clearing them." }, { status: 400 });
        continue;
      }
      const year = Number(row.year);
      const fields: Record<string, unknown> = {
        unit_number: unit || null,
        unit_type: row.unit_type === "trailer" ? "trailer" : "truck",
        vin: vin || null,
        license_plate: plate || null,
        year: Number.isInteger(year) && year >= 1980 && year <= thisYear + 1 ? year : null,
        make: cleanString(row.make, 60) || null,
        model: cleanString(row.model, 60) || null,
        carrier_confirmed_at: now,
        updated_at: now,
      };
      if (id) edits.push(service.from("vehicles").update(fields).eq("id", id).eq("client_id", client.id));
      else adds.push({ ...fields, client_id: client.id, status: "active" });
    }

    for (let i = 0; i < edits.length; i += 15) {
      const results = await Promise.all(edits.slice(i, i + 15));
      const failed = results.find((r) => r.error);
      if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }
    if (adds.length) {
      const { error } = await service.from("vehicles").insert(adds);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const note = cleanString(body.note, 600);
    const { count: active } = await service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "active");
    if (!active && !note) return NextResponse.json({ error: "Add at least one truck, or tell us in the note why there are none." }, { status: 400 });
    const { count: trucks } = await service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "active").eq("unit_type", "truck");
    const { error } = await service.from("clients").update({ trucks_confirmed_at: now, trucks_note: note || null, fleet_size: trucks || null }).eq("id", client.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlanEvent(client.id, "carrier_truck_list_confirmed", `Carrier confirmed the truck list: ${active ?? 0} units (${adds.length} added, ${removed} no longer run)`, {
      active: active ?? 0, added: adds.length, removed, note: note || null,
    });

    let sync: string;
    try {
      const result = await syncVehiclesToClientFile(service, client.id, client.email ?? "carrier");
      sync = syncSummary("vehicles", result);
      if (!result.skipped) await logPlanEvent(client.id, "client_file_synced", sync, { kind: "vehicles", ...result });
    } catch (syncError) {
      sync = `Client file not updated: ${syncError instanceof Error ? syncError.message : String(syncError)}`;
      await logPlanEvent(client.id, "client_file_sync_failed", sync, { kind: "vehicles" });
    }
    return NextResponse.json({ ok: true, trucks: active ?? 0, sync });
  });
}
