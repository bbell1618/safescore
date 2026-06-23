import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { RunAnalysisButton } from "@/components/console/run-analysis-button";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { diffSnapshots, getRecentSnapshots } from "@/lib/monitoring/diff";
import { ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

// Tooltip copy (verbatim per spec)

const TT = {
  POWER_UNITS:
    "Trucks and tractors the carrier operates, from its latest MCS-150. No fixed maximum. Used as the exposure denominator in several BASIC calculations \u2014 more units generally lowers per-unit violation rates.",
  DRIVERS:
    "Driver count from the latest MCS-150. No fixed maximum. This is the figure Total Safety per-driver billing reconciles to.",
  MCS150:
    "The carrier's most recent biennial census filing and the annual mileage reported with it. A stale MCS-150 distorts BASIC math; keeping it current is part of the service.",
  SAFETY_RATING:
    "FMCSA's compliance-review rating: Satisfactory, Conditional, or Unsatisfactory. 'Unrated / Non-Ratable' means no rated review is on file \u2014 common and not negative.",
  PERCENTILE:
    "The carrier's rank versus similar carriers, 0\u2013100. Higher is worse. FMCSA flags a category for intervention above a threshold that varies by BASIC (~50\u201375%). 'Not public' means FMCSA withholds it because the carrier has too few inspections to rank reliably.",
  ALERT:
    "Whether this BASIC is over FMCSA's intervention threshold. Over threshold = elevated scrutiny and intervention risk.",
  OOS_RATE:
    "Share of this carrier's inspections that resulted in an out-of-service order, 0\u2013100%. Lower is better. The reference line is the national average.",
  NATIONAL_AVG:
    "The all-carrier average OOS rate for this inspection type \u2014 FMCSA's reference point. Below it is good; above it is a flag.",
  CRASHES:
    "State-reported crashes involving this carrier in the last 24 months, regardless of fault. They feed the Crash Indicator BASIC, weighted by severity (tow-away < injury < fatal). Some may be removable via the CPDP program.",
  VIOLATIONS:
    "Individual violations cited across all roadside inspections in the window. Each carries a severity weight and a time weight (recent counts more) that drive the BASIC measures.",
  DATAQS:
    "Formal challenges (Requests for Data Review) to FMCSA disputing a violation or crash record. Successful challenges remove or correct the record, improving the score.",
};

// Status / tier maps

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

// Rule-based story strip

interface CrashRow {
  tow_away: boolean;
  fatalities: number;
  injuries: number;
}

interface ViolsByBasicMap {
  [category: string]: { count: number; oos: number; severity: number };
}

function buildStoryStrip(
  burden: { perBasic: Array<{ label: string; violationCount: number; weightedPoints: number }>; totalPoints: number },
  crashes: CrashRow[]
): string[] {
  const sentences: string[] = [];
  const topBasic = burden.perBasic[0];

  if (topBasic) {
    sentences.push(
      `${topBasic.label} carries the largest weighted burden: ${topBasic.weightedPoints} point${topBasic.weightedPoints !== 1 ? "s" : ""} across ${topBasic.violationCount} violation${topBasic.violationCount !== 1 ? "s" : ""}.`
    );
    sentences.push(
      `Total weighted violation burden is ${burden.totalPoints} points. FMCSA does not publish percentile rankings for low-volume carriers; this is the burden that drives the BASIC measures.`
    );
  }

  const totalCrashes = crashes.filter((c) => c != null).length;
  const towCount = crashes.filter((c) => c?.tow_away).length;
  if (totalCrashes > 0) {
    sentences.push(
      `${totalCrashes} crash${totalCrashes !== 1 ? "es" : ""} in the last 24 months${towCount > 0 ? ` (${towCount} tow-away - CPDP review may apply)` : ""}.`
    );
  }

  return sentences.length > 0
    ? sentences
    : ["No scored violation burden is currently present in the 24-month window."];
}
// Data freshness dot

function freshnessColor(saferAsOf: string | null): string {
  if (!saferAsOf) return "bg-gray-400";
  const days =
    (Date.now() - new Date(saferAsOf + "T12:00:00").getTime()) /
    (1000 * 60 * 60 * 24);
  if (days <= 45) return "bg-green-500";
  if (days <= 90) return "bg-amber-500";
  return "bg-red-500";
}

// Page

function signedDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function deltaClass(value: number) {
  if (value < 0) return "text-green-700";
  if (value > 0) return "text-[#B83B32]";
  return "text-gray-500";
}
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

  // 24-month trailing window \u2014 matches FMCSA's Crash Indicator BASIC window.
  // Computed once and reused for both crashRows and cpdpCandidates so both
  // lists are consistent and the Dec 2022 crash is excluded from both.
  const now24str = new Intl.DateTimeFormat("sv-SE").format(new Date());
  const cutoff24mo =
    (parseInt(now24str.slice(0, 4)) - 2).toString() + now24str.slice(4);

  const [
    { data: carrierProfile },
    { data: crashRows },
    { data: cpdpCandidates },
    { data: draftCases },
    { data: allCases },
    { count: violationCount },
    { count: caseCount },
  ] = await Promise.all([
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
  const [burden, monitoringSnapshots] = await Promise.all([
    getClientBurden(id),
    getRecentSnapshots(id, 2),
  ]);

  // Violation detail \u2014 fetch all fields needed for per-BASIC stats,
  // the bar chart, AND the points-ranked remediation queue.
  // time_weight is stored on violations (1=old, 2=mid, 3=recent).
  // Per-violation score impact = severity_weight \u00D7 time_weight.
  const { data: allViolations } = await supabase
    .from("violations")
    .select(
      "id, basic_category, oos_violation, severity_weight, time_weight, " +
      "violation_code, violation_description, " +
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
    inspections: { inspection_date: string } | null;
    points: number; // severity_weight \u00D7 time_weight
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

  // Story strip sentences (array, rendered as list items)
  const storySentences = buildStoryStrip(burden, crashes24m);

  // safer_as_of
  const saferAsOf = (carrierProfile as Record<string, unknown> | null)?.safer_as_of as string | null ?? null;

  const cp = carrierProfile as Record<string, unknown> | null;
  const latestSnapshot = monitoringSnapshots[0] ?? null;
  const previousSnapshot = monitoringSnapshots[1] ?? null;
  const monitoringDiff =
    latestSnapshot && previousSnapshot ? diffSnapshots(latestSnapshot, previousSnapshot) : null;
  const monitoringPerBasicDeltas = monitoringDiff
    ? [...monitoringDiff.perBasicDeltas].sort(
        (a, b) => Math.abs(b.pointsDelta) - Math.abs(a.pointsDelta)
      )
    : [];

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

      {/* Section 1: Header */}
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
              href={`/console/clients/${id}/remediation`}
              className="px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
            >
              Remediation
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

      {/* Section 2: Story strip */}
      {storySentences && storySentences.length > 0 && (
        <div className="bg-[#FDF4E7] border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-[#C67A1E] uppercase tracking-wide mb-2">
            Safety summary
          </p>
          <ul className="space-y-1.5">
            {storySentences.map((sentence, i) => (
              <li key={i} className="text-sm text-[#1E1C1A] leading-relaxed flex gap-2">
                <span className="text-[#C67A1E] shrink-0 mt-0.5">{"\u2014"}</span>
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Section 3: Carrier snapshot */}
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
                {cp.power_units != null ? String(cp.power_units) : "\u2014"}
              </p>
            </div>
            {/* Drivers */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">Drivers</p>
                <Tooltip content={TT.DRIVERS} />
              </div>
              <p className="text-2xl font-bold text-[#1E1C1A] mt-1">
                {cp.drivers != null ? String(cp.drivers) : "\u2014"}
              </p>
            </div>
            {/* MCS-150 */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <div className="flex items-center gap-0.5">
                <p className="text-xs text-gray-500">MCS-150 Filed</p>
                <Tooltip content={TT.MCS150} />
              </div>
              <p className="text-base font-bold text-[#1E1C1A] mt-1">
                {cp.mcs150_date ? formatDate(cp.mcs150_date as string) : "\u2014"}
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
                {cp.authority_status ? String(cp.authority_status) : "\u2014"}
              </p>
            </div>
            {/* Entity Type */}
            <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
              <p className="text-xs text-gray-500">Entity Type</p>
              <p className="text-sm font-semibold text-[#1E1C1A] mt-1">
                {cp.entity_type ? String(cp.entity_type) : "\u2014"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Section 5: CSA burden */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              CSA Burden (computed)
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              FMCSA does not publish percentile rankings for low-volume carriers; this is the weighted violation burden that drives the BASIC measures.
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
                        {v.inspectionDate ? formatDate(v.inspectionDate) : "--"} {"\u00B7"} Severity {v.severityWeight ?? "--"} {"\u00B7"} Time weight {v.timeWeight}
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

      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold text-[#1E1C1A] text-sm">Change since last refresh</h2>
            <p className="text-xs text-gray-500 mt-1">
              Snapshot-based net movement. Reductions are good; increases are factual follow-up items.
            </p>
          </div>
        </div>

        {latestSnapshot && previousSnapshot && monitoringDiff ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[#1E1C1A]">
              Change since {formatDate(previousSnapshot.snapshot_date)} -&gt; {formatDate(latestSnapshot.snapshot_date)}
            </p>
            <div className="grid gap-3 md:grid-cols-5">
              {[
                { label: "Weighted points", value: monitoringDiff.totalPointsDelta },
                { label: "Violations", value: monitoringDiff.violationCountDelta },
                { label: "OOS", value: monitoringDiff.oosCountDelta },
                { label: "Inspections", value: monitoringDiff.inspectionCountDelta },
                { label: "Crashes", value: monitoringDiff.crashCountDelta },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-lg border border-[#F0E8DA] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{item.label}</p>
                  <p className={`text-lg font-bold ${deltaClass(item.value)}`}>{signedDelta(item.value)}</p>
                </div>
              ))}
            </div>

            {monitoringPerBasicDeltas.length > 0 && (
              <div className="bg-white rounded-lg border border-[#F0E8DA] divide-y divide-[#F0E8DA]">
                {monitoringPerBasicDeltas.map((delta) => (
                  <div key={delta.basicCategory} className="px-4 py-3 flex items-center justify-between gap-4">
                    <span className="text-xs font-medium text-[#1E1C1A]">
                      {BASIC_LABELS[delta.basicCategory] ?? delta.basicCategory.replaceAll("_", " ")}
                    </span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className={deltaClass(delta.pointsDelta)}>
                        {signedDelta(delta.pointsDelta)} pts
                      </span>
                      <span className="text-gray-500">
                        {signedDelta(delta.countDelta)} violations
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : latestSnapshot ? (
          <p className="text-sm text-gray-600">
            Monitoring active - {monitoringSnapshots.length} snapshot on file (as of {formatDate(latestSnapshot.snapshot_date)}). Change tracking begins at the next refresh.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            Monitoring active - 0 snapshots on file. Change tracking begins after the first refresh.
          </p>
        )}
      </div>

      {/* Section 6: Violations by BASIC */}
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

      {/* Section 7: Crashes & CPDP */}
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
            Review crashes for CPDP {"\u2192"}
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

      {/* Section 8: Opportunities work queue */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">
            Remediation opportunities
          </h2>
          <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
            Ranked by score impact (severity {"\u00D7"} time weight)
          </span>
        </div>
        {/* Framing note */}
        <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
          Points = estimated score impact if the violation is removed via a successful DataQ challenge
          (FMCSA&apos;s published severity weight {"\u00D7"} time weight). Removability is a separate assessment {"\u2014"}
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
                        {bStats?.oos ? ` \u00B7 ${bStats.oos} OOS` : ""}
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
                              {v.violation_code ?? "\u2014"}
                            </span>
                            {v.oos_violation && (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                OOS
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
                              {v.severity_weight ?? 0}{"\u00D7"}{v.time_weight ?? 1}
                            </p>
                          </div>
                          <Link
                            href={`/console/clients/${id}/dataq`}
                            className="text-xs text-[#C67A1E] hover:underline"
                          >
                            Case {"\u2192"}
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
                        Tow-away {"\u2014"} {formatDate(c.crash_date as string)}
                        {c.state ? ` (${c.state})` : ""}
                      </p>
                      <Link
                        href={`/console/clients/${id}/cpdp`}
                        className="text-xs text-[#C67A1E] hover:underline shrink-0"
                      >
                        Review {"\u2192"}
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
                        Case for {viol?.violation_code ?? "violation"} {"\u2014"} created{" "}
                        {formatDate(c.created_at as string)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Draft {"\u2014"} narrative ready to finalize and file.
                      </p>
                    </div>
                    <Link
                      href={`/console/clients/${id}/dataq`}
                      className="text-xs text-[#C67A1E] hover:underline shrink-0"
                    >
                      File {"\u2192"}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Section 9: DataQs cases */}
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
                      ? `${(c.violations as { violation_code: string }[])[0]?.violation_code ?? "\u2014"}`
                      : (c.violations as { violation_code: string } | null)
                          ?.violation_code ?? "\u2014"}
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
