import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { syncDriversToClientFile, syncSummary } from "@/lib/autopilot/client-file-sync";
import { applyBilledDriverCount, priceChange } from "@/lib/billing/driver-pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v.trim()) ? v.trim() : null);
const state = (v: unknown) => { const s = cleanString(v, 2).toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : null; };

/**
 * QF-223: the carrier saves their whole driver list in one go from the one-page list.
 * Rows with an id are edits (or "no longer drives for us"); rows without one are new.
 * Saving confirms every driver left on the list, then updates the agency client file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as { rows?: unknown; acceptPriceFor?: unknown };
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 600) as Array<Record<string, unknown>> : null;
    if (!rows) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const service = serviceClient();
    const now = new Date().toISOString();

    const { data: existing, error: readError } = await service.from("drivers").select("id").eq("client_id", client.id).eq("status", "active");
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    const known = new Set((existing ?? []).map((r) => r.id as string));

    // QF-227: Total Safety is priced per driver. If this list changes the count they are billed
    // for, the carrier must agree to the new monthly price first (the page shows it and asks).
    const willHave = rows.filter((row) => row.active !== false && ((typeof row.id === "string" && known.has(row.id)) || cleanString(row.full_name, 120))).length;
    const { data: billing } = await service.from("clients").select("tier, status, billed_driver_count").eq("id", client.id).maybeSingle();
    const change = billing?.status === "active" ? priceChange(billing.tier, billing.billed_driver_count, willHave) : null;
    if (change && Number(body.acceptPriceFor) !== willHave) {
      return NextResponse.json({ error: "Please confirm your new monthly price.", priceChange: change }, { status: 409 });
    }

    const edits: Array<PromiseLike<{ error: { message: string } | null }>> = [];
    const adds: Array<Record<string, unknown>> = [];
    let removed = 0;
    for (const row of rows) {
      const id = typeof row.id === "string" && known.has(row.id) ? row.id : null;
      const name = cleanString(row.full_name, 120);
      const active = row.active !== false;
      if (id && !active) {
        edits.push(service.from("drivers").update({ status: "terminated", updated_at: now }).eq("id", id).eq("client_id", client.id));
        removed += 1;
        continue;
      }
      if (!active) continue;
      if (!name) {
        if (id) return NextResponse.json({ error: "Every driver needs a name. Untick anyone who no longer drives for you instead of clearing the name." }, { status: 400 });
        continue; // an empty new row is ignored
      }
      const fields: Record<string, unknown> = {
        full_name: name,
        cdl_state: state(row.cdl_state),
        cdl_expiry: date(row.cdl_expiry),
        medical_cert_expiry: date(row.medical_cert_expiry),
        carrier_confirmed_at: now,
        updated_at: now,
      };
      // Only a newly typed license number is saved; the masked one shown on screen never is.
      const license = cleanString(row.cdl_number, 30).toUpperCase().replace(/\s+/g, "");
      if (license && !license.includes("•")) fields.cdl_number = license;
      if (id) edits.push(service.from("drivers").update(fields).eq("id", id).eq("client_id", client.id));
      else adds.push({ ...fields, client_id: client.id, status: "active", source: "client_portal", notes: `Added by the carrier on ${now.slice(0, 10)}.` });
    }

    for (let i = 0; i < edits.length; i += 15) {
      const results = await Promise.all(edits.slice(i, i + 15));
      const failed = results.find((r) => r.error);
      if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }
    if (adds.length) {
      const { error } = await service.from("drivers").insert(adds);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { count: active } = await service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "active");
    if (!active) return NextResponse.json({ error: "Add at least one driver. If you drive the truck yourself, add yourself." }, { status: 400 });

    await service.from("client_requests")
      .update({ status: "fulfilled", submitted_at: now, closed_at: now, next_reminder_at: null, updated_at: now, response: { via: "setup_list", drivers: active } })
      .eq("dedupe_key", `roster_collection:${client.id}`);
    await service.from("clients").update({ driver_count: active }).eq("id", client.id);
    await logPlanEvent(client.id, "carrier_driver_list_confirmed", `Carrier confirmed the driver list: ${active} drivers (${adds.length} added, ${removed} no longer driving)`, { active, added: adds.length, removed });

    // QF-227: the carrier agreed above, so charge for the new count from now on.
    let billingNote: string | null = null;
    if (change) {
      const billed = await applyBilledDriverCount(service, client.id, active, client.email ?? "carrier");
      if (!billed.ok) billingNote = billed.error;
    } else if (billing?.tier === "total_safety" && billing.status === "active") {
      await service.from("clients").update({ price_confirm_card_count: null }).eq("id", client.id);
    }

    let sync: string;
    try {
      const result = await syncDriversToClientFile(service, client.id, client.email ?? "carrier");
      sync = syncSummary("drivers", result);
      if (!result.skipped) await logPlanEvent(client.id, "client_file_synced", sync, { kind: "drivers", ...result });
    } catch (error) {
      sync = `Client file not updated: ${error instanceof Error ? error.message : String(error)}`;
      await logPlanEvent(client.id, "client_file_sync_failed", sync, { kind: "drivers" });
    }
    return NextResponse.json({ ok: true, drivers: active, sync, billingNote });
  });
}
