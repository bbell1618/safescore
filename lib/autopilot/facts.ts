import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BASIC_LABELS, timeWeightFor } from "@/lib/analysis/basic-measure";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { mapViolationToFamily } from "@/lib/playbooks/families";
import { FAMILY_DEFINITIONS } from "@/lib/playbooks/templates";
import type { PlaybookFamilyKey } from "@/lib/playbooks/types";

/**
 * Deterministic facts about one carrier. Everything a plan, email or report
 * says about the carrier must come from here, never from the model.
 */
export type FamilyFact = {
  key: PlaybookFamilyKey;
  name: string;
  points: number;
  share: number;
  count: number;
  oosCount: number;
  recentCount: number;
  topDescriptions: string[];
  program: string[];
  workingWhen: string[];
};

export type CarrierFacts = {
  asOf: string;
  company: string;
  dotNumber: string;
  powerUnits: number | null;
  drivers: number | null;
  totalPoints: number;
  violationCount: number;
  inspectionCount: number;
  oosViolationCount: number;
  lastInspectionDate: string | null;
  perBasic: Array<{ key: string; label: string; points: number; count: number }>;
  families: FamilyFact[];
  crashes: Array<{ date: string; state: string | null; towAway: boolean; injuries: number; fatalities: number; ageMonths: number }>;
  crashReviewCandidates: number;
  oos: {
    vehicleRate: number | null;
    driverRate: number | null;
    nationalVehicleRate: number | null;
    nationalDriverRate: number | null;
    inspectionsWithOosShare: number | null;
  };
  hasRecord: boolean;
};

type ViolationRow = {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  inspections: { inspection_date: string | null } | { inspection_date: string | null }[] | null;
};

function inspectionDate(row: ViolationRow): string | null {
  const value = Array.isArray(row.inspections) ? row.inspections[0] : row.inspections;
  return value?.inspection_date ?? null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function monthsBetween(from: string, to: Date) {
  const d = new Date(`${from}T00:00:00Z`);
  return (to.getUTCFullYear() - d.getUTCFullYear()) * 12 + (to.getUTCMonth() - d.getUTCMonth());
}

export type OosInput = {
  vehicleOosRate: number | null;
  driverOosRate: number | null;
  nationalVehicleOosRate: number | null;
  nationalDriverOosRate: number | null;
};

export async function buildCarrierFacts(
  service: SupabaseClient,
  clientId: string,
  oosInput?: OosInput | null
): Promise<CarrierFacts> {
  const now = new Date();
  const [{ data: client, error: clientError }, { data: profile }, scope] = await Promise.all([
    service.from("clients").select("id, name, dot_number").eq("id", clientId).single(),
    service
      .from("carrier_profiles")
      .select("legal_name, power_units, drivers, national_vehicle_oos_rate, national_driver_oos_rate")
      .eq("client_id", clientId)
      .maybeSingle(),
    getCanonicalInspectionScope(clientId, service),
  ]);
  if (clientError || !client) throw new Error(`Carrier not found: ${clientError?.message ?? clientId}`);

  const inspectionIds = scope.inspectionIds;
  const violations: ViolationRow[] = [];
  if (inspectionIds.length > 0) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await service
        .from("violations")
        .select("id, violation_code, violation_description, basic_category, severity_weight, oos_violation, inspections(inspection_date)")
        .eq("client_id", clientId)
        .in("inspection_id", inspectionIds)
        .range(from, from + 999);
      if (error) throw new Error(`Unable to load violations: ${error.message}`);
      violations.push(...((data ?? []) as ViolationRow[]));
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const { data: inspections, error: inspectionError } = inspectionIds.length
    ? await service.from("inspections").select("id, inspection_date, oos_violations").in("id", inspectionIds)
    : { data: [], error: null };
  if (inspectionError) throw new Error(`Unable to load inspections: ${inspectionError.message}`);
  let lastInspectionDate: string | null = null;
  let inspectionsWithOos = 0;
  for (const inspection of inspections ?? []) {
    const date = inspection.inspection_date as string | null;
    if (date && (!lastInspectionDate || date > lastInspectionDate)) lastInspectionDate = date;
    if (Number(inspection.oos_violations ?? 0) > 0) inspectionsWithOos += 1;
  }

  const perBasicMap = new Map<string, { points: number; count: number }>();
  const familyMap = new Map<PlaybookFamilyKey, { points: number; count: number; oos: number; recent: number; descriptions: Map<string, number> }>();
  let totalPoints = 0;
  let oosViolationCount = 0;
  let inWindow = 0;
  for (const row of violations) {
    const date = inspectionDate(row);
    const timeWeight = timeWeightFor(date, now);
    if (timeWeight === 0) continue;
    inWindow += 1;
    const oos = row.oos_violation === true;
    if (oos) oosViolationCount += 1;
    const points = timeWeight * ((row.severity_weight ?? 0) + (oos ? 2 : 0));
    totalPoints += points;
    const basic = row.basic_category ?? "unknown";
    const b = perBasicMap.get(basic) ?? { points: 0, count: 0 };
    b.points += points;
    b.count += 1;
    perBasicMap.set(basic, b);
    const { familyKey } = mapViolationToFamily(row.violation_code ?? "");
    const f = familyMap.get(familyKey) ?? { points: 0, count: 0, oos: 0, recent: 0, descriptions: new Map() };
    f.points += points;
    f.count += 1;
    if (oos) f.oos += 1;
    if (timeWeight === 3) f.recent += 1;
    const description = (row.violation_description ?? row.violation_code ?? "").trim();
    if (description) f.descriptions.set(description, (f.descriptions.get(description) ?? 0) + 1);
    familyMap.set(familyKey, f);
  }

  const families: FamilyFact[] = [...familyMap.entries()]
    .map(([key, f]) => {
      const def = FAMILY_DEFINITIONS[key];
      return {
        key,
        name: def?.name ?? "General safety",
        points: f.points,
        share: totalPoints > 0 ? round1((f.points / totalPoints) * 100) : 0,
        count: f.count,
        oosCount: f.oos,
        recentCount: f.recent,
        topDescriptions: [...f.descriptions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d} (${n}x)`),
        program: def?.program ?? [],
        workingWhen: def?.workingWhen ?? [],
      };
    })
    .sort((a, b) => b.points - a.points);

  const { data: crashRows, error: crashError } = await service
    .from("crashes")
    .select("crash_date, state, tow_away, injuries, fatalities, fmcsa_not_preventable")
    .eq("client_id", clientId)
    .order("crash_date", { ascending: false });
  if (crashError) throw new Error(`Unable to load crashes: ${crashError.message}`);
  const crashes = (crashRows ?? [])
    .filter((c) => c.crash_date && monthsBetween(c.crash_date as string, now) < 24)
    .map((c) => ({
      date: c.crash_date as string,
      state: (c.state as string | null)?.trim() ?? null,
      towAway: c.tow_away === true,
      injuries: Number(c.injuries ?? 0),
      fatalities: Number(c.fatalities ?? 0),
      ageMonths: monthsBetween(c.crash_date as string, now),
      notPreventable: c.fmcsa_not_preventable === true,
    }));

  return {
    asOf: now.toISOString().slice(0, 10),
    company: (client.name as string) || ((profile?.legal_name as string | undefined) ?? ""),
    dotNumber: client.dot_number as string,
    powerUnits: (profile?.power_units as number | null) ?? null,
    drivers: (profile?.drivers as number | null) ?? null,
    totalPoints,
    violationCount: inWindow,
    inspectionCount: inspectionIds.length,
    oosViolationCount,
    lastInspectionDate,
    perBasic: [...perBasicMap.entries()]
      .map(([key, value]) => ({ key, label: BASIC_LABELS[key] ?? "Other", points: value.points, count: value.count }))
      .sort((a, b) => b.points - a.points),
    families,
    crashes: crashes.map(({ notPreventable: _n, ...rest }) => rest),
    crashReviewCandidates: crashes.filter((c) => c.towAway && !c.notPreventable).length,
    oos: {
      vehicleRate: oosInput?.vehicleOosRate ?? null,
      driverRate: oosInput?.driverOosRate ?? null,
      nationalVehicleRate: oosInput?.nationalVehicleOosRate ?? (profile?.national_vehicle_oos_rate as number | null) ?? 22.26,
      nationalDriverRate: oosInput?.nationalDriverOosRate ?? (profile?.national_driver_oos_rate as number | null) ?? 6.67,
      inspectionsWithOosShare: (inspections?.length ?? 0) > 0 ? round1((inspectionsWithOos / (inspections?.length ?? 1)) * 100) : null,
    },
    hasRecord: inspectionIds.length > 0 || crashes.length > 0,
  };
}
