import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goldenDeskClient } from "./contacts";

/**
 * QF-215: when a carrier is already a GEIA client, start its SafeScore file with the drivers and
 * vehicles the agency already has, so the carrier is never asked to type in what we know.
 *
 * Only fills an empty list (never duplicates on a re-run). License numbers are left in the client
 * file on purpose: the carrier's driver-list page opens from an emailed link with no password.
 */

const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const state = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

export type ClientFileImport = { drivers: number; vehicles: number };

export async function importFromClientFile(service: SupabaseClient, clientId: string, goldendeskClientId: string | null): Promise<ClientFileImport> {
  const out: ClientFileImport = { drivers: 0, vehicles: 0 };
  const gd = goldendeskClientId ? goldenDeskClient() : null;
  if (!gd || !goldendeskClientId) return out;
  const note = `From the GEIA client file on ${new Date().toISOString().slice(0, 10)}. Not yet confirmed by the carrier.`;

  const { count: haveDrivers } = await service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (!haveDrivers) {
    const { data, error } = await gd
      .from("drivers")
      .select("name, license_state, cdl_class, cdl_expires_at, cdl_expiration, dot_medical_expires_at, medical_card_expiration, hire_date")
      .eq("client_id", goldendeskClientId)
      .eq("held_status", "current")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(`client file drivers: ${error.message}`);
    const rows = (data ?? [])
      .filter((d) => text(d.name))
      .map((d) => ({
        client_id: clientId,
        full_name: text(d.name)!,
        cdl_state: state(d.license_state),
        cdl_class: text(d.cdl_class, 10),
        cdl_expiry: day(d.cdl_expires_at) ?? day(d.cdl_expiration),
        medical_cert_expiry: day(d.dot_medical_expires_at) ?? day(d.medical_card_expiration),
        hired_date: day(d.hire_date),
        source: "operator",
        notes: note,
      }));
    if (rows.length) {
      const { error: insertError } = await service.from("drivers").insert(rows);
      if (insertError) throw new Error(`driver copy: ${insertError.message}`);
      out.drivers = rows.length;
    }
  }

  const { count: haveVehicles } = await service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (!haveVehicles) {
    const { data, error } = await gd
      .from("units")
      .select("unit_number, vin, year, make, model, plate, plate_state, annual_inspection_date")
      .eq("client_id", goldendeskClientId)
      .eq("held_status", "current")
      .is("deleted_at", null)
      .order("unit_number", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`client file vehicles: ${error.message}`);
    const rows = (data ?? [])
      .filter((u) => text(u.vin) || text(u.unit_number))
      .map((u) => ({
        client_id: clientId,
        unit_number: text(u.unit_number, 40),
        vin: text(u.vin, 40),
        year: Number.isInteger(u.year) ? (u.year as number) : null,
        make: text(u.make, 60),
        model: text(u.model, 60),
        license_plate: text(u.plate, 20),
        plate_state: state(u.plate_state),
        annual_inspection_date: day(u.annual_inspection_date),
      }));
    if (rows.length) {
      const { error: insertError } = await service.from("vehicles").insert(rows);
      if (insertError) throw new Error(`vehicle copy: ${insertError.message}`);
      out.vehicles = rows.length;
    }
  }
  return out;
}
