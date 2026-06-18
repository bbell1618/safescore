import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { RunAnalysisButton } from "@/components/console/run-analysis-button";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

// ── Tooltip copy (verbatim per spec) ─────────────────────────────────────────

const TT = {
  POWER_UNITS:
    "Trucks and tractors the carrier operates, from its latest MCS-150. No fixed maximum. Used as the exposure denominator in several BASIC calculations — more units generally lowers per-unit violation rates.",
  DRIVERS:
    "Driver count from the latest MCS-150. No fixed maximum. This is the figure Total Safety per-driver billing reconciles to.",
  MCS150:
    "The carrier's most recent biennial census filing and the annual mileage reported with it. A stale MCS-150 distorts BASIC math; keeping it current is part of the service.",
  SAFETY_RATING:
    "FMCSA's compliance-review rating: Satisfactory, Conditional, or Unsatisfactory. 'Unrated / Non-Ratable' means no rated review is on file — common and not negative.",
  PERCENTILE:
    "The carrier's rank versus similar carriers, 0–100. Higher is worse. FMCSA flags a category for intervention above a threshold that varies by BASIC (~50–75%). 'Not public' means FMCSA withholds it because the carrier has too few inspections to rank reliably.",
  ALERT:
    "Whether this BASIC is over FMCSA's intervention threshold. Over threshold = elevated scrutiny and intervention risk.",
  OOS_RATE:
    "Share of this carrier's inspections that resulted in an out-of-service order, 0–100%. Lower is better. The reference line is the national average.",
  NATIONAL_AVG:
    "The all-carrier average OOS rate for this inspection type — FMCSA's reference point. Below it is good; above it is a flag.",
  CRASHES:
    "State-reported crashes involving this carrier in the last 24 months, regardless of fault. They feed the Crash Indicator BASIC, weighted by severity (tow-away < injury < fatal). Some may be removable via the CPDP program.",
  VIOLATIONS:
    "Individual violations cited across all roadside inspections in the window. Each carries a severity weight and a time weight (recent counts more) that drive the BASIC measures.",
  DATAQS:
    "Formal challenges (Requests for Data Review) to FMCSA disputing a violation or crash record. Successful challenges remove or correct the record, improving the score.",
};

function basicMeasureTooltip(categoryName: string): string {
  return (
    `${categoryName} BASIC measure. A severity- and time-weighted rate of this category's violations from roadside inspections. ` +
    `No fixed 0–100 scale; higher is worse. The comparable 0–100 scale is the percentile below — when FMCSA doesn't publish one, ` +
    `compare this against the carrier's other categories and the alert flag.`
  );
}

// ── Status / tier maps ────────────────────────────────────────────────────────

const statusVariant: Record<string, "success" | "default" | "warning" | "danger" | "outline"> = {
  onboarding: "warning",
  active: "success",
  prospect: "outline",
  paused: "warning",
  churned: "default",
};

const statusLabel: Record<string, string> = {
  onboarding: "Onboarding",
  active: "Active",
  prospect: "Prospect",
  paused: "Paused",
  churned: "Churned",
};

const tierLabel: Record<string, string> = {
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

// ── Rule-based story strip ────────────────────────────────────────────────────

interface StorySnapshot {
  unsafe_driving_measure: number | null;
  unsafe_driving_alert: boolean | null;
  hos_compliance_measure: number | null;
  hos_compliance_alert: boolean | null;
  driver_fitness_measure: number | null;
  driver_fitness_alert: boolean | null;
  controlled_substance_measure: number | null;
  controlled_substance_alert: boolean | null;
  vehicle_maint_measure: number | null;
  vehicle_maint_alert: boolean | null;
  hm_compliance_measure: number | null;
  hm_compliance_alert: boolean | null;
  crash_indicator_measure: number | null;
  crash_indicator_alert: boolean | null;
  oos_vehicle_rate: number | null;
  oos_hazmat_rate: number | null;
}

interface CrashRow {
  tow_away: boolean;
  fatalities: number;
  injuries: number;
}

interface BasicStat {
  category: string;
  label: string;
  count: number;
  oos: number;
  severity: number;
}

interface ViolsByBasicMap {
  [category: string]: { count: number; oos: number; severity: number };
}

function buildStoryStrip(
  snapshot: StorySnapshot,
  violsByBasic: ViolsByBasicMap,
  crashes: CrashRow[]
): string[] {
  const sentences: string[] = [];

  // 1. Lead with the BASIC carrying the most combined burden (violations + OOS)
  const basicOrder = [
    { category: "vehicle_maintenance", label: "Vehicle Maintenance" },
    { category: "hos_compliance", label: "HOS Compliance" },
    { category: "unsafe_driving", label: "Unsafe Driving" },
    { category: "driver_fitness", label: "Driver Fitness" },
    { category: "controlled_substance", label: "Controlled Substances" },
    { category: "hm_compliance", label: "Hazmat Compliance" },
    { category: "crash_indicator", label: "Crash Indicator" },
  ];

  const statsWithData: BasicStat[] = basicOrder
    .filter((b) => (violsByBasic[b.category]?.count ?? 0) > 0)
    .map((b) => ({ ...b, ...violsByBasic[b.category] }))
    .sort(
      (a, b) =>
        b.count + b.oos * 2 + b.severity * 0.1 -
        (a.count + a.oos * 2 + a.severity * 0.1)
    );

  const topBasic = statsWithData[0];
  if (topBasic) {
    sentences.push(
      `${topBasic.label} carries the largest violation burden: ${topBasic.count} violation${topBasic.count !== 1 ? "s" : ""} with ${topBasic.oos} OOS across the inspection window.`
    );
  }

  // 2. State whether any BASIC exceeds the intervention threshold
  const anyAlert = [
    snapshot.unsafe_driving_alert,
    snapshot.hos_compliance_alert,
    snapshot.driver_fitness_alert,
    snapshot.controlled_substance_alert,
    snapshot.vehicle_maint_alert,
    snapshot.hm_compliance_alert,
    snapshot.crash_indicator_alert,
  ].some(Boolean);

  if (!anyAlert) {
    sentences.push(
      "No BASIC currently exceeds an FMCSA intervention threshold — the carrier is not in elevated-scrutiny status."
    );
  } else {
    const alertedNames = [
      snapshot.unsafe_driving_alert && "Unsafe Driving",
      snapshot.hos_compliance_alert && "HOS Compliance",
      snapshot.driver_fitness_alert && "Driver Fitness",
      snapshot.controlled_substance_alert && "Controlled Substances",
      snapshot.vehicle_maint_alert && "Vehicle Maintenance",
      snapshot.hm_compliance_alert && "Hazmat Compliance",
      snapshot.crash_indicator_alert && "Crash Indicator",
    ].filter(Boolean) as string[];
    sentences.push(
      `${alertedNames.join(" and ")} ${alertedNames.length === 1 ? "is" : "are"} over the FMCSA intervention threshold.`
    );
  }

  // 3. Caveat the highest raw measure — do NOT present it as the priority
  const measures = [
    { name: "Unsafe Driving", val: snapshot.unsafe_driving_measure },
    { name: "HOS Compliance", val: snapshot.hos_compliance_measure },
    { name: "Driver Fitness", val: snapshot.driver_fitness_measure },
    { name: "Controlled Substances", val: snapshot.controlled_substance_measure },
    { name: "Vehicle Maintenance", val: snapshot.vehicle_maint_measure },
    { name: "Hazmat Compliance", val: snapshot.hm_compliance_measure },
    { name: "Crash Indicator", val: snapshot.crash_indicator_measure },
  ]
    .filter((m) => m.val != null)
    .sort((a, b) => (b.val ?? 0) - (a.val ?? 0));

  const highestMeasure = measures[0];
  if (highestMeasure && highestMeasure.val != null) {
    sentences.push(
      `${highestMeasure.name} shows the highest raw measure (${highestMeasure.val.toFixed(2)}), but BASIC measures aren't comparable across categories and FMCSA doesn't publish percentiles for this carrier, so relative ranking isn't available.`
    );
  }

  // 4. Crashes
  const totalCrashes = crashes.filter((c) => c != null).length;
  const towCount = crashes.filter((c) => c?.tow_away).length;
  if (totalCrashes > 0) {
    sentences.push(
      `${totalCrashes} crash${totalCrashes !== 1 ? "es" : ""} in the last 24 months${towCount > 0 ? ` (${towCount} tow-away — CPDP review may apply)` : ""}.`
    );
  }

  return sentences.length > 0
    ? sentences
    : ["No significant safety flags identified in current data."];
}

// ── Data freshness dot ────────────────────────────────────────────────────────

function freshnessColor(saferAsOf: string | null): string {
  if (!saferAsOf) return "bg-gray-400";
  const days =
    (Date.now() - new Date(saferAsOf + "T12:00:00").getTime()) /
    (1000 * 60 * 60 * 24);
  if (days <= 45) return "bg-green-500";
  if (days <= 90) return "bg-amber-500";
  return "bg-red-500";
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  // 24-month trailing window — matches FMCSA's Crash Indicator BASIC window.
  // Computed once and reused for both crashRows and cpdpCandidates so both
  // lists are consistent and the Dec 2022 crash is excluded from both.
  const now24str = new Intl.DateTimeFormat("sv-SE").format(new Date());
  const cutoff24mo =
    (parseInt(now24str.slice(0, 4)) - 2).toString() + now24str.slice(4);

  const [
    { data: snapshot },
    { data: carrierProfile },
    { data: crashRows },
    { data: activeCases },
    { data: challengeableViolations },
    { data: cpdpCandidates },
    { data: draftCases },
    { data: allCases },
    { count: violationCount },
    { count: caseCount },
  ] = await Promise.all([
    supabase
      .from("score_snapshots")
      .select("*")
      .eq("client_id", id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("carrier_profiles")
      .select("*")
      .eq("client_id", id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("crashes")
      .select("crash_date, fatalities, injuries, tow_away, cpdp_eligible")
      .eq("client_id", id)
      .gte("crash_date", cutoff24mo)
      .order("crash_date", { ascending: false }),
    supabase
      .from("dataq_cases")
      .select("*, violations(violation_code, violation_description)")
      .eq("client_id", id)
      .not("status", "in", '("approved","denied","closed")')
      .order("created_at", { ascending: false })
      .limit(5),
    // Top challengeable violations in the highest-measure BASIC (for opportunities)
    supabase
      .from("violations")
      .select("id, violation_code, violation_description, basic_category, severity_weight, challenge_reason")
      .eq("client_id", id)
      .eq("challengeable", true)
      .order("severity_weight", { ascending: false })
      .limit(3),
    // CPDP candidates: tow_away crashes within the 24-month window with no assessment
    supabase
      .from("crashes")
      .select("id, crash_date, state")
      .eq("client_id", id)
      .eq("tow_away", true)
      .is("cpdp_eligible", null)
      .gte("crash_date", cutoff24mo)
      .limit(5),
    // Draft DataQ cases
    supabase
      .from("dataq_cases")
      .select("id, created_at, violations(violation_code)")
      .eq("client_id", id)
      .eq("status", "draft")
      .limit(5),
    // All cases (for section 9)
    supabase
      .from("dataq_cases")
      .select("id, status, created_at, violations(violation_code, violation_description)")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("violations").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("dataq_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
  ]);
  const burden = await getClientBurden(id);

  // Violation detail — fetch all fields needed for per-BASIC stats,
  // the bar chart, AND the points-ranked remediation queue.
  // time_weight is stored on violations (1=old, 2=mid, 3=recent).
  // Per-violation score impact = severity_weight × time_weight.
  const { data: allViolations } = await supabase
    .from("violations")
    .select(
      "id, basic_category, oos_violation, severity_weight, time_weight, " +
      "violation_code, violation_description, challengeable, " +
      "inspections(inspection_date)"
    )
    .eq("client_id", id);

  // Typed row for computed violation data
  interface ViolationRow {
    id: string;
    basic_category: string | null;
    oos_violation: boolean | null;
    severity_weight: number | null;
    time_weight: number | null;
    violation_code: string | null;
    violation_description: string | null;
    challengeable: boolean | null;
    inspections: { inspection_date: string } | null;
    points: number; // severity_weight × time_weight
  }

  const violRows: ViolationRow[] = (allViolations ?? []).map((v) => {
    const row = v as unknown as Record<string, unknown>;
    const sw = (row.severity_weight as number | null) ?? 0;
    const tw = (row.time_weight as number | null) ?? 1;
    const oos = (row.oos_violation as boolean | null) ?? false;
    const insp = row.inspections as { inspection_date: string } | null;
    return {
      id: row.id as string,
      basic_category: row.basic_category as string | null,
      oos_violation: oos,
      severity_weight: row.severity_weight as number | null,
      time_weight: row.time_weight as number | null,
      violation_code: row.violation_code as string | null,
      violation_description: row.violation_description as string | null,
      challengeable: row.challengeable as boolean | null,
      inspections: insp,
      points: (sw + (oos ? 2 : 0)) * tw,
    };
  });

  // Build per-BASIC violation stats (for existing bar chart + story strip)
  const violsByBasic: ViolsByBasicMap = {};
  for (const v of violRows) {
    const cat = v.basic_category ?? "unknown";
    if (!violsByBasic[cat]) violsByBasic[cat] = { count: 0, oos: 0, severity: 0 };
    violsByBasic[cat].count++;
    if (v.oos_violation) violsByBasic[cat].oos++;
    violsByBasic[cat].severity += v.severity_weight ?? 0;
  }

  // Sorted by count for the bar chart
  const violsByBasicSorted = Object.entries(violsByBasic)
    .map(([cat, stats]) => [cat, stats.count] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const maxViolCount = violsByBasicSorted[0]?.[1] ?? 1;

  // Per-BASIC total points and sorted violation list for the opportunity queue.
  // Violations are sorted within each BASIC by points desc.
  interface BasicPoints {
    category: string;
    totalPoints: number;
    violations: ViolationRow[];
  }
  const basicPointsMap = new Map<string, BasicPoints>();
  for (const v of violRows) {
    const cat = v.basic_category ?? "unknown";
    if (!basicPointsMap.has(cat)) {
      basicPointsMap.set(cat, { category: cat, totalPoints: 0, violations: [] });
    }
    const entry = basicPointsMap.get(cat)!;
    entry.totalPoints += v.points;
    entry.violations.push(v);
  }
  // Sort BASICs by total points desc; within each BASIC sort violations by points desc
  const basicsByPoints: BasicPoints[] = Array.from(basicPointsMap.values())
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((bp) => ({
      ...bp,
      violations: [...bp.violations].sort((a, b) => b.points - a.points),
    }));

  const basicCategoryLabel: Record<string, string> = {
    unsafe_driving: "Unsafe Driving",
    hos_compliance: "HOS Compliance",
    driver_fitness: "Driver Fitness",
    controlled_substance: "Controlled Substances",
    vehicle_maintenance: "Vehicle Maintenance",
    hazmat_compliance: "Hazmat Compliance",
    crash_indicator: "Crash Indicator",
    unknown: "Unknown",
  };

  // Crash breakdown
  const crashes24m = crashRows ?? [];
  const crashFatal = crashes24m.filter((c) => c.fatalities > 0).length;
  const crashInjury = crashes24m.filter((c) => c.injuries > 0).length;
  const crashTow = crashes24m.filter((c) => c.tow_away).length;

  // BASIC scores array
  const basicsArray = snapshot
    ? [
        {
          key: "unsafeDriving",
          label: "Unsafe Driving",
          measure: snapshot.unsafe_driving_measure as number | null,
          percentile: snapshot.unsafe_driving_pct as number | null,
          alert: snapshot.unsafe_driving_alert as boolean,
        },
        {
          key: "hosCompliance",
          label: "HOS Compliance",
          measure: snapshot.hos_compliance_measure as number | null,
          percentile: snapshot.hos_compliance_pct as number | null,
          alert: snapshot.hos_compliance_alert as boolean,
        },
        {
          key: "driverFitness",
          label: "Driver Fitness",
          measure: snapshot.driver_fitness_measure as number | null,
          percentile: snapshot.driver_fitness_pct as number | null,
          alert: snapshot.driver_fitness_alert as boolean,
        },
        {
          key: "controlledSubstance",
          label: "Controlled Substances",
          measure: snapshot.controlled_substance_measure as number | null,
          percentile: snapshot.controlled_substance_pct as number | null,
          alert: snapshot.controlled_substance_alert as boolean,
        },
        {
          key: "vehicleMaint",
          label: "Vehicle Maintenance",
          measure: snapshot.vehicle_maint_measure as number | null,
          percentile: snapshot.vehicle_maint_pct as number | null,
          alert: snapshot.vehicle_maint_alert as boolean,
        },
        {
          key: "hmCompliance",
          label: "Hazmat Compliance",
          measure: snapshot.hm_compliance_measure as number | null,
          percentile: snapshot.hm_compliance_pct as number | null,
          alert: snapshot.hm_compliance_alert as boolean,
        },
        {
          key: "crashIndicator",
          label: "Crash Indicator",
          measure: snapshot.crash_indicator_measure as number | null,
          percentile: snapshot.crash_indicator_pct as number | null,
          alert: snapshot.crash_indicator_alert as boolean,
        },
      ]
    : [];

  // Story strip sentences (array, rendered as list items)
  const storySentences =
    snapshot
      ? buildStoryStrip(
          snapshot as unknown as StorySnapshot,
          violsByBasic,
          crashes24m
        )
      : null;

  // Top BASIC by burden (for opportunity queue ordering)
  const basicBurdenOrder = [
    { category: "vehicle_maintenance" },
    { category: "hos_compliance" },
    { category: "unsafe_driving" },
    { category: "driver_fitness" },
    { category: "controlled_substance" },
    { category: "hm_compliance" },
    { category: "crash_indicator" },
  ]
    .filter((b) => (violsByBasic[b.category]?.count ?? 0) > 0)
    .sort((a, b) => {
      const sa = violsByBasic[a.category];
      const sb = violsByBasic[b.category];
      return (
        sb.count + sb.oos * 2 + sb.severity * 0.1 -
        (sa.count + sa.oos * 2 + sa.severity * 0.1)
      );
    });
  const topBurdenCategory = basicBurdenOrder[0]?.category ?? null;

  // safer_as_of
  const saferAsOf = (carrierProfile as Record<string, unknown> | null)?.safer_as_of as string | null ?? null;

  const cp = carrierProfile as Record<string, unknown> | null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#C67A1E]">
          Clients
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">{client.name}</span>
      </div>

      {/* ── Section 1: Header ─────────────────────────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-xl font-bold text-[#1E1C1A]">
                {client.name}
              </h1>
              {client.tier && (
                <Badge
                  variant={
                    client.tier === "total_safety"
                      ? "gold"
                      : client.tier === "remediate"
                      ? "info"
                      : "default"
                  }
                >
                  {tierLabel[client.tier]}
                </Badge>
              )}
              <Badge
                variant={
                  (statusVariant[client.status] ?? "default") as
                    | "success"
                    | "default"
                    | "warning"
                    | "danger"
                }
              >
                {statusLabel[client.status] ?? client.status}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              USDOT: {client.dot_number}
              {client.mc_number ? ` | MC-${client.mc_number}` : ""}
              {cp?.authority_status
                ? ` | ${cp.authority_status as string}`
                : ""}
            </p>
            {/* Data freshness */}
            <div className="flex items-center gap-1.5 mt-2">
              <span
                className={`w-2 h-2 rounded-full inline-block ${freshnessColor(saferAsOf)}`}
              />
              <span className="text-xs text-gray-400">
                {saferAsOf
                  ? `Data as of ${formatDate(saferAsOf)}`
                  : "Data freshness unknown"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0 items-center">
            <RunAnalysisButton
              clientId={id}
              dotNumber={client.dot_number}
              hasData={(violationCount ?? 0) > 0}
              hasFmcsaAccess={false}
            />
            <Link
              href={`/console/clients/${id}/violations`}
              className="px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
            >
              Violations ({violationCount ?? 0})
            </Link>
            <Link
              href={`/console/clients/${id}/dataq`}
              className="px-3 py-1.5 text-xs font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] transition-colors"
            >
              DataQs ({caseCount ?? 0})
            </Link>
          </div>
        </div>
      </div>

      {/* ── Section 2: Story strip ────────────────────────────────────────── */}
      {storySentences && storySentences.length > 0 && (
        <div className="bg-[#FDF4E7] border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-[#C67A1E] uppercase tracking-wide mb-2">
            Safety summary
          </p>
          <ul className="space-y-1.5">
            {storySentences.map((sentence, i) => (
              <li key={i} className="text-sm text-[#1E1C1A] leading-relaxed flex gap-2">
                <span className="text-[#C67A1E] shrink-0 mt-0.5">—</span>
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Section 3: Carrier snapshot ──────────────────────────────────── */}
      {cp && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm mb-4">
            Carrier snapshot
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {/* Power Units */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">Power Units</p>
                <Tooltip content={TT.POWER_UNITS} />
              </div>
              <p className="text-2xl font-bold text-[#1E1C1A] mt-1">
                {cp.power_units != null ? String(cp.power_units) : "—"}
              </p>
            </div>
            {/* Drivers */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">Drivers</p>
                <Tooltip content={TT.DRIVERS} />
              </div>
              <p className="text-2xl font-bold text-[#1E1C1A] mt-1">
                {cp.drivers != null ? String(cp.drivers) : "—"}
              </p>
            </div>
            {/* MCS-150 */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">MCS-150 Filed</p>
                <Tooltip content={TT.MCS150} />
              </div>
              <p className="text-base font-bold text-[#1E1C1A] mt-1">
                {cp.mcs150_date ? formatDate(cp.mcs150_date as string) : "—"}
              </p>
              {cp.mcs150_mileage != null && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {Number(cp.mcs150_mileage).toLocaleString()} mi
                  {cp.mcs150_mileage_year ? ` (${cp.mcs150_mileage_year})` : ""}
                </p>
              )}
            </div>
            {/* Safety Rating */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">Safety Rating</p>
                <Tooltip content={TT.SAFETY_RATING} />
              </div>
              <p className="text-sm font-semibold text-[#1E1C1A] mt-1">
                {cp.safety_rating
                  ? String(cp.safety_rating)
                  : cp.review_type
                  ? String(cp.review_type)
                  : "Unrated / Non-Ratable"}
              </p>
            </div>
            {/* Authority Status */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <p className="text-xs text-gray-500">Authority Status</p>
              <p className="text-sm font-semibold text-[#1E1C1A] mt-1">
                {cp.authority_status ? String(cp.authority_status) : "—"}
              </p>
            </div>
            {/* Entity Type */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <p className="text-xs text-gray-500">Entity Type</p>
              <p className="text-sm font-semibold text-[#1E1C1A] mt-1">
                {cp.entity_type ? String(cp.entity_type) : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 4: BASIC scores ───────────────────────────────────────── */}
      {basicsArray.length > 0 && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              BASIC scores
              {snapshot && (
                <span className="text-gray-400 font-normal text-xs ml-2">
                  as of {formatDate(snapshot.snapshot_date as string)}
                </span>
              )}
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {basicsArray.map((b) => {
              // Map basicsArray label back to the category key used in violsByBasic
              const categoryKeyMap: Record<string, string> = {
                "Unsafe Driving": "unsafe_driving",
                "HOS Compliance": "hos_compliance",
                "Driver Fitness": "driver_fitness",
                "Controlled Substances": "controlled_substance",
                "Vehicle Maintenance": "vehicle_maintenance",
                "Hazmat Compliance": "hm_compliance",
                "Crash Indicator": "crash_indicator",
              };
              const catKey = categoryKeyMap[b.label] ?? "";
              const basicStats = violsByBasic[catKey];
              return (
                <div
                  key={b.key}
                  className="rounded-lg border border-[#F0E8DA] bg-white p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 font-medium">
                      {b.label}
                    </span>
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-bold text-[#1E1C1A]">
                      {b.measure != null ? b.measure.toFixed(2) : "—"}
                    </span>
                    <Tooltip
                      content={basicMeasureTooltip(b.label)}
                      position="top"
                    />
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-gray-400">
                      {b.percentile != null
                        ? `${b.percentile}th percentile`
                        : "Not public — too few inspections to rank"}
                    </span>
                    <Tooltip content={TT.PERCENTILE} position="bottom" />
                  </div>
                  {/* Per-BASIC violation and OOS counts */}
                  {basicStats && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[11px] text-gray-500 bg-[#F0E8DA] rounded px-1.5 py-0.5">
                        {basicStats.count} violation{basicStats.count !== 1 ? "s" : ""}
                      </span>
                      {basicStats.oos > 0 && (
                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          {basicStats.oos} OOS
                        </span>
                      )}
                    </div>
                  )}
                  {b.alert && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Badge variant="warning">Over threshold</Badge>
                      <Tooltip content={TT.ALERT} position="bottom" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Section 5: OOS rates ─────────────────────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              CSA Burden (computed)
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Percentile is not published by FMCSA for low-volume carriers. SafeScore shows the weighted point burden that drives your BASIC measures.
            </p>
          </div>
          <span className="text-xs text-gray-400">As of {formatDate(burden.asOf)}</span>
        </div>

        {burden.perBasic.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead className="bg-[#FEFCF8] border-b border-[#F0E8DA]">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">BASIC</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Weighted points</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">24-mo violations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0E8DA]">
                {burden.perBasic.map((b) => (
                  <tr key={b.basicCategory}>
                    <td className="px-5 py-3 text-xs font-medium text-[#1E1C1A]">{b.label}</td>
                    <td className="px-5 py-3 text-right text-xs font-semibold text-[#C67A1E]">{b.weightedPoints}</td>
                    <td className="px-5 py-3 text-right text-xs text-gray-500">{b.violationCount}</td>
                  </tr>
                ))}
                <tr className="bg-[#FEFCF8]">
                  <td className="px-5 py-3 text-xs font-semibold text-[#1E1C1A]">Total</td>
                  <td className="px-5 py-3 text-right text-xs font-bold text-[#1E1C1A]">{burden.totalPoints}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">
                    {burden.perBasic.reduce((sum, b) => sum + b.violationCount, 0)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="px-5 py-4 border-t border-[#F0E8DA]">
              <h3 className="font-semibold text-[#1E1C1A] text-sm mb-3">
                Top violations by score impact
              </h3>
              <div className="bg-white rounded-lg border border-[#F0E8DA] divide-y divide-[#F0E8DA]">
                {burden.topViolations.map((v) => (
                  <div key={v.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-[#1E1C1A]">
                          {v.violationCode || "--"}
                        </span>
                        <span className="text-[10px] text-gray-500 bg-[#F0E8DA] rounded px-1.5 py-0.5">
                          {BASIC_LABELS[v.basicCategory ?? ""] ?? v.basicCategory ?? "Unknown"}
                        </span>
                        {v.oosViolation && (
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            OOS
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5 truncate">
                        {v.violationDescription ?? ""}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {v.inspectionDate ? formatDate(v.inspectionDate) : "--"} · Severity {v.severityWeight ?? "--"} · Time weight {v.timeWeight}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-[#1E1C1A] shrink-0">
                      {v.points} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No scored violations in the 24-month window.</p>
          </div>
        )}
      </div>

      {snapshot && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm mb-4">
            Out-of-service rates
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {(
              [
                {
                  label: "Vehicle",
                  rate: snapshot.oos_vehicle_rate as number | null,
                  // Use SAFER-parsed national average stored on carrier_profiles;
                  // fall back to FMCSA published figure if column not yet populated.
                  national: (cp?.national_vehicle_oos_rate as number | null) ?? 22.26,
                },
                {
                  label: "Driver",
                  rate: snapshot.oos_driver_rate as number | null,
                  national: (cp?.national_driver_oos_rate as number | null) ?? 6.67,
                },
                {
                  label: "Hazmat",
                  rate: snapshot.oos_hazmat_rate as number | null,
                  national: (cp?.national_hazmat_oos_rate as number | null) ?? 4.44,
                },
              ] as { label: string; rate: number | null; national: number }[]
            ).map(({ label, rate, national }) => {
              const aboveAvg = rate != null && rate > national;
              return (
                <div
                  key={label}
                  className="bg-white rounded-lg border border-[#F0E8DA] p-4"
                >
                  <p className="text-xs text-gray-500 font-medium mb-2">
                    {label} OOS Rate
                  </p>
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-bold text-[#1E1C1A]">
                      {rate != null ? `${rate.toFixed(1)}%` : "—"}
                    </span>
                    <Tooltip content={TT.OOS_RATE} />
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-gray-400">
                      Nat. avg: {national.toFixed(1)}%
                    </span>
                    <Tooltip content={TT.NATIONAL_AVG} position="bottom" />
                  </div>
                  {rate != null && (
                    <div className="mt-2">
                      <Badge variant={aboveAvg ? "warning" : "success"}>
                        {aboveAvg ? "Above national average" : "Below national average"}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Section 6: Violations by BASIC ───────────────────────────────── */}
      {violsByBasicSorted.length > 0 && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <div className="flex items-center gap-1 mb-4">
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              Violations by BASIC
            </h2>
            <Tooltip content={TT.VIOLATIONS} />
          </div>
          <div className="space-y-3">
            {violsByBasicSorted.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-40 shrink-0">
                  {basicCategoryLabel[cat] ?? cat}
                </span>
                <div className="flex-1 bg-[#F0E8DA] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-[#C67A1E]"
                    style={{ width: `${(count / maxViolCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-[#1E1C1A] w-6 text-right shrink-0">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 7: Crashes & CPDP ────────────────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              Crashes &amp; CPDP
            </h2>
            <Tooltip content={TT.CRASHES} />
          </div>
          <Link
            href={`/console/clients/${id}/cpdp`}
            className="text-xs text-[#C67A1E] hover:underline"
          >
            Review crashes for CPDP →
          </Link>
        </div>
        {crashes24m.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-3">
              {(
                [
                  { label: "Fatal", count: crashFatal },
                  { label: "Injury", count: crashInjury },
                  { label: "Tow-away", count: crashTow },
                ] as { label: string; count: number }[]
              ).map(({ label, count }) => (
                <div
                  key={label}
                  className="bg-white rounded-lg border border-[#F0E8DA] p-4 text-center"
                >
                  <p className="text-2xl font-bold text-[#1E1C1A]">{count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            {crashTow > 0 && (
              <p className="text-xs text-gray-500">
                Tow-away crashes may be eligible for CPDP review to remove them
                from the Crash Indicator BASIC.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400">No crashes on record.</p>
        )}
      </div>

      {/* ── Section 8: Opportunities work queue ──────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">
            Remediation opportunities
          </h2>
          <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
            Ranked by score impact (severity × time weight)
          </span>
        </div>
        {/* Framing note */}
        <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
          Points = estimated score impact if the violation is removed via a successful DataQ challenge
          (FMCSA&apos;s published severity weight × time weight). Removability is a separate assessment —
          high-impact does not mean challengeable. The authenticated SMS export would give FMCSA&apos;s exact
          computed contribution; this uses the published weighting as an approximation.
        </p>
        <div className="space-y-4">

          {/* 1. Per-BASIC violation groups, ordered by total points */}
          {basicsByPoints.length > 0 ? (
            basicsByPoints.map((bp) => {
              const catLabel = basicCategoryLabel[bp.category] ?? bp.category;
              const bStats = violsByBasic[bp.category];
              // Show top 5 violations by points within this BASIC
              const topViols = bp.violations.slice(0, 5);
              return (
                <div key={bp.category}>
                  {/* BASIC group header */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      {catLabel}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-400">
                        {bStats?.count ?? 0} violations
                        {bStats?.oos ? ` · ${bStats.oos} OOS` : ""}
                      </span>
                      <span className="text-[11px] font-semibold text-[#C67A1E] bg-[#FDF4E7] border border-amber-200 rounded px-2 py-0.5">
                        {bp.totalPoints} pts total
                      </span>
                    </div>
                  </div>
                  {/* Violation rows */}
                  <div className="bg-white rounded-lg border border-[#F0E8DA] divide-y divide-[#F0E8DA]">
                    {topViols.map((v) => (
                      <div key={v.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-[#1E1C1A]">
                              {v.violation_code ?? "—"}
                            </span>
                            {v.oos_violation && (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                OOS
                              </span>
                            )}
                            {v.challengeable === true && (
                              <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                                Challengeable
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5 truncate">
                            {v.violation_description ?? ""}
                          </p>
                          {v.inspections?.inspection_date && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {formatDate(v.inspections.inspection_date)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-[#1E1C1A]">
                              {v.points} pts
                            </p>
                            <p className="text-[10px] text-gray-400">
                              {v.severity_weight ?? 0}×{v.time_weight ?? 1}
                            </p>
                          </div>
                          <Link
                            href={`/console/clients/${id}/dataq`}
                            className="text-xs text-[#C67A1E] hover:underline"
                          >
                            Case →
                          </Link>
                        </div>
                      </div>
                    ))}
                    {bp.violations.length > 5 && (
                      <div className="px-4 py-2">
                        <p className="text-[11px] text-gray-400">
                          +{bp.violations.length - 5} more violations in this BASIC
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-gray-400">
              No violations on record. Run a full analysis to assess violations.
            </p>
          )}

          {/* 2. CPDP crash review */}
          {cpdpCandidates && cpdpCandidates.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  CPDP crash review
                </p>
              </div>
              <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
                <p className="text-sm font-medium text-[#1E1C1A]">
                  {crashes24m.length} crash{crashes24m.length !== 1 ? "es" : ""}
                  {crashTow > 0 ? ` (${crashTow} tow-away)` : ""} may qualify for CPDP preventability review
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  A successful CPDP determination removes the crash from the Crash Indicator BASIC.
                </p>
                <div className="mt-2 space-y-1">
                  {cpdpCandidates.map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      <p className="text-xs text-gray-600 flex-1">
                        Tow-away — {formatDate(c.crash_date as string)}
                        {c.state ? ` (${c.state})` : ""}
                      </p>
                      <Link
                        href={`/console/clients/${id}/cpdp`}
                        className="text-xs text-[#C67A1E] hover:underline shrink-0"
                      >
                        Review →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 3. Draft DataQs cases */}
          {draftCases && draftCases.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Draft DataQs cases (not yet filed)
              </p>
              {draftCases.map((c) => {
                const viol = Array.isArray(c.violations)
                  ? (c.violations as { violation_code: string }[])[0]
                  : (c.violations as { violation_code: string } | null);
                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-lg border border-[#F0E8DA] p-4 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1E1C1A]">
                        Case for {viol?.violation_code ?? "violation"} — created{" "}
                        {formatDate(c.created_at as string)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Draft — narrative ready to finalize and file.
                      </p>
                    </div>
                    <Link
                      href={`/console/clients/${id}/dataq`}
                      className="text-xs text-[#C67A1E] hover:underline shrink-0"
                    >
                      File →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 9: DataQs cases ───────────────────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#F0E8DA] flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3 className="font-semibold text-[#1E1C1A] text-sm">
              DataQs cases
            </h3>
            <Tooltip content={TT.DATAQS} />
          </div>
          <Link
            href={`/console/clients/${id}/dataq`}
            className="text-xs text-[#C67A1E] hover:underline"
          >
            View all
          </Link>
        </div>
        {allCases && allCases.length > 0 ? (
          <div className="divide-y divide-[#F0E8DA]">
            {allCases.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1E1C1A] truncate">
                    {Array.isArray(c.violations)
                      ? `${(c.violations as { violation_code: string }[])[0]?.violation_code ?? "—"}`
                      : (c.violations as { violation_code: string } | null)
                          ?.violation_code ?? "—"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {Array.isArray(c.violations)
                      ? (
                          c.violations as { violation_description: string }[]
                        )[0]?.violation_description
                      : (
                          c.violations as {
                            violation_description: string;
                          } | null
                        )?.violation_description ?? ""}
                  </p>
                </div>
                <Badge variant={caseStatusVariant(c.status as string)}>
                  {caseStatusLabel(c.status as string)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No DataQs cases yet.</p>
            <Link
              href={`/console/clients/${id}/violations`}
              className="text-xs text-[#C67A1E] hover:underline mt-1 inline-block"
            >
              Analyze violations to create cases
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
