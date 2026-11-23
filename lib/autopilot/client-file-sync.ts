import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goldenDeskClient } from "./contacts";

/**
 * QF-223 (Brandon, 11/23/2026): the driver list and truck list a carrier confirms in SafeScore are
 * the real lists, so the agency client file is updated to match.
 *
 * It follows the same rules as the agency's own client portal, so nothing on the insurance
 * policy changes by itself:
 *  - someone new        -> added as current, marked "pending addition" to the policy schedule
 *  - someone who left   -> marked former (no longer with the carrier); the policy schedule is left
 *                          alone, so the client file shows "should be removed" for the CSR
 *  - someone confirmed  -> marked current; empty license details are filled in; expiry dates follow
 *                          the carrier's newer answer
 * Practice copies never touch a client file.
 */

export type SyncResult = { skipped?: string; added: number; updated: number; former: number; linked: number };

const empty = (): SyncResult => ({ added: 0, updated: 0, former: 0, linked: 0 });
const nameKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const vinKey = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const unitKey = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const today = () => new Date().toISOString().slice(0, 10);
const CLASSES = new Set(["A", "B", "C"]);

type CarrierRow = { id: string; name: string; goldendesk_client_id: string | null; is_practice: boolean | null };

async function carrier(service: SupabaseClient, clientId: string): Promise<CarrierRow | null> {
  const { data } = await service.from("clients").select("id, name, goldendesk_client_id, is_practice").eq("id", clientId).maybeSingle();
  return (data as CarrierRow | null) ?? null;
}

function skipReason(c: CarrierRow | null): string | null {
  if (!c) return "carrier not found";
  if (c.is_practice) return "practice copy";
  if (!c.goldendesk_client_id) return "no agency client file";
  return null;
}

export async function syncDriversToClientFile(service: SupabaseClient, clientId: string, actor: string): Promise<SyncResult> {
  const c = await carrier(service, clientId);
  const skip = skipReason(c);
  if (skip) return { ...empty(), skipped: skip };
  const gd = goldenDeskClient();
  if (!gd) return { ...empty(), skipped: "agency database not configured" };
  const gdClient = c!.goldendesk_client_id!;
  const by = `portal:safescore (${actor})`;
  const now = new Date().toISOString();
  const out = empty();

  const [{ data: gdRows, error: gdError }, { data: ssRows, error: ssError }] = await Promise.all([
    gd.from("drivers")
      .select("id, name, license_number, license_state, cdl_class, cdl_expires_at, cdl_expiration, dot_medical_expires_at, medical_card_expiration, held_status, schedule_status, employment_status")
      .eq("client_id", gdClient).is("deleted_at", null).limit(2000),
    service.from("drivers")
      .select("id, full_name, cdl_state, cdl_number, cdl_class, cdl_expiry, medical_cert_expiry, status, carrier_confirmed_at, gd_driver_id")
      .eq("client_id", clientId).limit(2000),
  ]);
  if (gdError) throw new Error(`client file drivers: ${gdError.message}`);
  if (ssError) throw new Error(`carrier drivers: ${ssError.message}`);

  const gdById = new Map((gdRows ?? []).map((r) => [r.id as string, r]));
  const taken = new Set((ssRows ?? []).map((r) => r.gd_driver_id as string | null).filter(Boolean) as string[]);
  const byName = new Map<string, Array<Record<string, unknown>>>();
  for (const r of gdRows ?? []) {
    if (taken.has(r.id as string)) continue;
    const k = nameKey(r.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), r]);
  }

  for (const d of ssRows ?? []) {
    let match = d.gd_driver_id ? gdById.get(d.gd_driver_id as string) : undefined;
    if (!match) {
      const list = byName.get(nameKey(d.full_name)) ?? [];
      // Prefer the row that is current in the client file.
      const pick = list.find((r) => r.held_status === "current") ?? list[0];
      if (pick) {
        match = pick as NonNullable<typeof gdRows>[number];
        byName.set(nameKey(d.full_name), list.filter((r) => r !== pick));
        await service.from("drivers").update({ gd_driver_id: pick.id }).eq("id", d.id);
        out.linked += 1;
      }
    }
    const active = d.status === "active";
    if (active && d.carrier_confirmed_at) {
      if (match) {
        const patch: Record<string, unknown> = {};
        if (match.held_status !== "current") Object.assign(patch, { held_status: "current", held_until: null, disposition: null, disposition_note: null });
        if (match.employment_status && match.employment_status !== "Active") patch.employment_status = "Active";
        if (blank(match.license_state) && d.cdl_state) patch.license_state = d.cdl_state;
        if (blank(match.license_number) && d.cdl_number) patch.license_number = d.cdl_number;
        if (blank(match.cdl_class) && d.cdl_class && CLASSES.has(String(d.cdl_class).toUpperCase())) patch.cdl_class = String(d.cdl_class).toUpperCase();
        if (d.cdl_expiry && d.cdl_expiry !== (match.cdl_expires_at ?? match.cdl_expiration)) Object.assign(patch, { cdl_expires_at: d.cdl_expiry, cdl_expiration: d.cdl_expiry });
        if (d.medical_cert_expiry && d.medical_cert_expiry !== (match.dot_medical_expires_at ?? match.medical_card_expiration)) {
          Object.assign(patch, { dot_medical_expires_at: d.medical_cert_expiry, medical_card_expiration: d.medical_cert_expiry });
        }
        if (Object.keys(patch).length) {
          const { error } = await gd.from("drivers").update({ ...patch, portal_updated_at: now, portal_updated_by: by, updated_at: now }).eq("id", match.id);
          if (error) throw new Error(`client file driver update: ${error.message}`);
          out.updated += 1;
        }
      } else {
        const { data: created, error } = await gd.from("drivers").insert({
          client_id: gdClient,
          name: d.full_name,
          license_state: d.cdl_state ?? null,
          license_number: d.cdl_number ?? null,
          cdl_class: d.cdl_class && CLASSES.has(String(d.cdl_class).toUpperCase()) ? String(d.cdl_class).toUpperCase() : null,
          cdl_expires_at: d.cdl_expiry ?? null,
          cdl_expiration: d.cdl_expiry ?? null,
          dot_medical_expires_at: d.medical_cert_expiry ?? null,
          medical_card_expiration: d.medical_cert_expiry ?? null,
          employment_status: "Active",
          held_status: "current",
          held_from: today(),
          schedule_status: "pending_addition",
          portal_added_at: now,
          portal_updated_at: now,
          portal_updated_by: by,
          notes: `Added by the carrier on their SafeScore driver list on ${today()}.`,
        }).select("id").single();
        if (error) throw new Error(`client file driver add: ${error.message}`);
        await service.from("drivers").update({ gd_driver_id: created.id }).eq("id", d.id);
        out.added += 1;
      }
    } else if (!active && match && match.held_status !== "former") {
      const { error } = await gd.from("drivers").update({
        held_status: "former",
        held_until: today(),
        employment_status: "Inactive",
        disposition: "other",
        disposition_note: `The carrier's SafeScore driver list on ${today()} says this driver no longer drives for them.`,
        portal_updated_at: now,
        portal_updated_by: by,
        updated_at: now,
      }).eq("id", match.id);
      if (error) throw new Error(`client file driver former: ${error.message}`);
      out.former += 1;
    }
  }
  await service.from("clients").update({ client_file_synced_at: now }).eq("id", clientId);
  return out;
}

export async function syncVehiclesToClientFile(service: SupabaseClient, clientId: string, actor: string): Promise<SyncResult> {
  const c = await carrier(service, clientId);
  const skip = skipReason(c);
  if (skip) return { ...empty(), skipped: skip };
  const gd = goldenDeskClient();
  if (!gd) return { ...empty(), skipped: "agency database not configured" };
  const gdClient = c!.goldendesk_client_id!;
  const by = `portal:safescore (${actor})`;
  const now = new Date().toISOString();
  const out = empty();

  const [{ data: gdRows, error: gdError }, { data: ssRows, error: ssError }] = await Promise.all([
    gd.from("units").select("id, unit_number, vin, year, make, model, plate, plate_state, type, held_status")
      .eq("client_id", gdClient).is("deleted_at", null).limit(3000),
    service.from("vehicles").select("id, unit_number, unit_type, vin, year, make, model, license_plate, plate_state, status, carrier_confirmed_at, gd_unit_id")
      .eq("client_id", clientId).limit(3000),
  ]);
  if (gdError) throw new Error(`client file units: ${gdError.message}`);
  if (ssError) throw new Error(`carrier vehicles: ${ssError.message}`);

  const gdById = new Map((gdRows ?? []).map((r) => [r.id as string, r]));
  const taken = new Set((ssRows ?? []).map((r) => r.gd_unit_id as string | null).filter(Boolean) as string[]);
  const free = (gdRows ?? []).filter((r) => !taken.has(r.id as string));

  for (const v of ssRows ?? []) {
    let match = v.gd_unit_id ? gdById.get(v.gd_unit_id as string) : undefined;
    if (!match) {
      const vk = vinKey(v.vin);
      const uk = unitKey(v.unit_number);
      const pick = (vk.length >= 11 ? free.find((r) => vinKey(r.vin) === vk) : undefined)
        ?? (uk ? free.find((r) => unitKey(r.unit_number) === uk && (!vk || !vinKey(r.vin))) : undefined);
      if (pick) {
        match = pick;
        free.splice(free.indexOf(pick), 1);
        await service.from("vehicles").update({ gd_unit_id: pick.id }).eq("id", v.id);
        out.linked += 1;
      }
    }
    const active = v.status === "active";
    if (active && v.carrier_confirmed_at) {
      if (match) {
        const patch: Record<string, unknown> = {};
        if (match.held_status !== "current") Object.assign(patch, { held_status: "current", held_until: null, disposition: null, disposition_note: null });
        if (blank(match.unit_number) && v.unit_number) patch.unit_number = v.unit_number;
        if (blank(match.vin) && v.vin) patch.vin = String(v.vin).toUpperCase();
        if (blank(match.year) && v.year) patch.year = v.year;
        if (blank(match.make) && v.make) patch.make = v.make;
        if (blank(match.model) && v.model) patch.model = v.model;
        if (blank(match.plate) && v.license_plate) patch.plate = v.license_plate;
        if (Object.keys(patch).length) {
          const { error } = await gd.from("units").update({ ...patch, portal_updated_at: now, portal_updated_by: by, updated_at: now }).eq("id", match.id);
          if (error) throw new Error(`client file unit update: ${error.message}`);
          out.updated += 1;
        }
      } else {
        const { data: created, error } = await gd.from("units").insert({
          client_id: gdClient,
          type: v.unit_type === "trailer" ? "Trailer" : "Power Unit",
          unit_number: v.unit_number ?? null,
          vin: v.vin ? String(v.vin).toUpperCase() : null,
          year: v.year ?? null,
          make: v.make ?? null,
          model: v.model ?? null,
          plate: v.license_plate ?? null,
          plate_state: v.plate_state ?? null,
          held_status: "current",
          held_from: today(),
          schedule_status: "pending_addition",
          portal_added_at: now,
          portal_updated_at: now,
          portal_updated_by: by,
          notes: `Added by the carrier on their SafeScore truck list on ${today()}.`,
        }).select("id").single();
        if (error) throw new Error(`client file unit add: ${error.message}`);
        await service.from("vehicles").update({ gd_unit_id: created.id }).eq("id", v.id);
        out.added += 1;
      }
    } else if (!active && match && match.held_status !== "former") {
      const { error } = await gd.from("units").update({
        held_status: "former",
        held_until: today(),
        disposition: "other",
        disposition_note: `The carrier's SafeScore truck list on ${today()} says they no longer run this ${match.type === "Trailer" ? "trailer" : "truck"}.`,
        portal_updated_at: now,
        portal_updated_by: by,
        updated_at: now,
      }).eq("id", match.id);
      if (error) throw new Error(`client file unit former: ${error.message}`);
      out.former += 1;
    }
  }
  await service.from("clients").update({ client_file_synced_at: now }).eq("id", clientId);
  return out;
}

/** One line for the activity log and the carrier page. */
export function syncSummary(kind: "drivers" | "vehicles", r: SyncResult): string {
  if (r.skipped) return `Client file not updated (${r.skipped}).`;
  const noun = kind === "drivers" ? "driver" : "unit";
  const parts = [
    r.added ? `${r.added} ${noun}${r.added === 1 ? "" : "s"} added (pending addition to the policy)` : null,
    r.former ? `${r.former} marked no longer with the carrier` : null,
    r.updated ? `${r.updated} updated` : null,
  ].filter(Boolean);
  return parts.length ? `Client file updated from the carrier's ${kind === "drivers" ? "driver" : "truck"} list: ${parts.join(", ")}.` : `Client file already matched the carrier's ${kind === "drivers" ? "driver" : "truck"} list.`;
}
