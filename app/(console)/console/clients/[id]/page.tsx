import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { getClientBasicReconciliation } from "@/lib/analysis/basic-reconciliation-server";
import { getRecentSnapshots } from "@/lib/monitoring/diff";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { formatViolationWindowSummary } from "@/lib/analysis/violation-list";

export const dynamic = "force-dynamic";

const TT = {
  POWER_UNITS:
    "Trucks and tractors the carrier operates, from its latest MCS-150. Used as the exposure denominator in several BASIC calculations.",
  DRIVERS:
    "Driver count from the latest MCS-150. Total Safety per-driver billing reconciles to this when available.",
  MCS150:
    "The carrier's most recent biennial census filing and annual mileage. A stale MCS-150 can distort BASIC math.",
  SAFETY_RATING:
    "FMCSA compliance-review rating. Unrated / Non-Ratable is common and not negative by itself.",
};

interface CrashRow {
  tow_away: boolean | null;
  fatalities: number | null;
  injuries: number | null;
}

function buildStoryStrip(
  burden: { perBasic: Array<{ label: string; violationCount: number; weightedPoints: number }>; totalPoints: number },
  crashes: CrashRow[]
) {
  const topBasic = burden.perBasic[0];
  const sentences: string[] = [];

  if (topBasic) {
    sentences.push(
      `${topBasic.label} carries the largest in-window burden: ${topBasic.weightedPoints} point${topBasic.weightedPoints === 1 ? "" : "s"} across ${topBasic.violationCount} violation${topBasic.violationCount === 1 ? "" : "s"}.`
    );
    sentences.push(
      `Total in-window weighted burden is ${burden.totalPoints}. FMCSA does not publish public percentiles for low-volume carriers; this is the burden that drives the BASIC measures.`
    );
  }

  const totalCrashes = crashes.length;
  const towCount = crashes.filter((c) => c.tow_away).length;
  if (totalCrashes > 0) {
    sentences.push(
      `${totalCrashes} crash${totalCrashes === 1 ? "" : "es"} in the 24-month window${towCount > 0 ? `, including ${towCount} tow-away crash${towCount === 1 ? "" : "es"} for CPDP review` : ""}.`
    );
  }

  return sentences.length > 0
    ? sentences
    : ["No scored violation burden is currently present in the 24-month window."];
}

export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
  const cutoff24mo = (parseInt(today.slice(0, 4)) - 2).toString() + today.slice(4);
  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(id, supabase);
  const violationCountQuery = supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);

  const [
    { data: carrierProfile },
    { data: crashRows },
    { count: violationCount },
    { count: dataqCount },
    { count: cpdpCount },
    reconciliation,
    monitoringSnapshots,
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
      .select("tow_away, fatalities, injuries")
      .eq("client_id", id)
      .gte("crash_date", cutoff24mo),
    canonicalInspectionIds.length > 0
      ? violationCountQuery.in("inspection_id", canonicalInspectionIds)
      : violationCountQuery.in("inspection_id", []),
    supabase.from("dataq_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("cpdp_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
    getClientBasicReconciliation(id),
    getRecentSnapshots(id, 2),
  ]);

  const cp = carrierProfile as Record<string, unknown> | null;
  const crashes = (crashRows ?? []) as CrashRow[];
  const burden = reconciliation.burden;
  const storySentences = buildStoryStrip(burden, crashes);
  const latestSnapshot = monitoringSnapshots[0] ?? null;
  const previousSnapshot = monitoringSnapshots[1] ?? null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <section className="bg-[#FDF4E7] border border-amber-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-[#C67A1E] uppercase tracking-wide mb-2">
          Safety summary
        </p>
        <ul className="space-y-1.5">
          {storySentences.map((sentence, i) => (
            <li key={i} className="text-sm text-[#1E1C1A] leading-relaxed flex gap-2">
              <span className="text-[#C67A1E] shrink-0">{"\u2014"}</span>
              <span>{sentence}</span>
            </li>
          ))}
        </ul>
      </section>

      {cp && (
        <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm mb-4">Carrier snapshot</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <SnapshotStat label="Power Units" value={cp.power_units} tooltip={TT.POWER_UNITS} />
            <SnapshotStat label="Drivers" value={cp.drivers} tooltip={TT.DRIVERS} />
            <SnapshotStat
              label="MCS-150 Filed"
              value={cp.mcs150_date ? formatDate(cp.mcs150_date as string) : null}
              tooltip={TT.MCS150}
              subvalue={
                cp.mcs150_mileage != null
                  ? `${Number(cp.mcs150_mileage).toLocaleString()} mi${cp.mcs150_mileage_year ? ` (${cp.mcs150_mileage_year})` : ""}`
                  : null
              }
            />
            <SnapshotStat
              label="Safety Rating"
              value={cp.safety_rating ?? cp.review_type ?? "Unrated / Non-Ratable"}
              tooltip={TT.SAFETY_RATING}
              compact
            />
            <SnapshotStat label="Authority Status" value={cp.authority_status} compact />
            <SnapshotStat label="Entity Type" value={cp.entity_type} compact />
          </div>
        </section>
      )}

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              In-window weighted burden {"\u2014"} drives the BASIC measures (total {burden.totalPoints})
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              FMCSA does not publish public percentile rankings for low-volume carriers; this is the corrected weighted burden in the 24-month window.
            </p>
          </div>
          <span className="text-xs text-gray-400">As of {formatDate(burden.asOf)}</span>
        </div>

        {burden.perBasic.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-[#FEFCF8] border-b border-[#F0E8DA]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">BASIC</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">In-window weighted burden (points)</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Scored violations (count)</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Potential removal impact (points)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {burden.perBasic.map((b) => (
                <tr key={b.basicCategory}>
                  <td className="px-5 py-3 text-xs font-medium text-[#1E1C1A]">{b.label}</td>
                  <td className="px-5 py-3 text-right text-xs font-semibold text-[#C67A1E]">{b.weightedPoints}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">{b.violationCount}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">
                    {(reconciliation.challengeabilityByBasic[b.basicCategory]?.unassessed ?? 0) > 0
                      ? "Not assessed"
                      : reconciliation.potentialRemovalImpactByBasic[b.basicCategory] ?? 0}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-5 py-3 text-xs font-medium text-[#1E1C1A]">Unknown / unclassified BASIC</td>
                <td className="px-5 py-3 text-right text-xs text-gray-500">Not computed</td>
                <td className="px-5 py-3 text-right text-xs text-gray-500">{reconciliation.unknownBasicCount}</td>
                <td className="px-5 py-3 text-right text-xs text-gray-500">Not assessed</td>
              </tr>
              <tr className="bg-[#FEFCF8]">
                <td className="px-5 py-3 text-xs font-semibold text-[#1E1C1A]">Total</td>
                <td className="px-5 py-3 text-right text-xs font-bold text-[#1E1C1A]">{burden.totalPoints}</td>
                <td className="px-5 py-3 text-right text-xs text-gray-500">
                  {burden.perBasic.reduce((sum, b) => sum + b.violationCount, 0)}
                </td>
                <td className="px-5 py-3 text-right text-xs font-bold text-[#1E1C1A]">
                  {reconciliation.allScoredViolationsAssessed
                    ? Object.values(reconciliation.potentialRemovalImpactByBasic).reduce((sum, points) => sum + points, 0)
                    : "Not assessed"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No scored violations in the 24-month window.</p>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500 -mt-3">
        Potential removal impact includes only strong/moderate evidence-based challenge candidates and assumes a successful correction. Investigate items are excluded. Unknown BASIC rows are counted but cannot receive burden or removal-impact points until classified.
      </p>
      <p className="text-xs text-gray-500 -mt-3">
        Pending evidence: {Object.values(reconciliation.pendingInvestigationByBasic).reduce((sum, item) => sum + item.count, 0)} violations, {Object.values(reconciliation.pendingInvestigationByBasic).reduce((sum, item) => sum + item.points, 0)} points at stake - not yet removable.
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryLink
          title="Violations"
          value={`${violationCount ?? 0} total violations on file`}
          body={formatViolationWindowSummary(
            violationCount ?? 0,
            reconciliation.queryTrace.inWindowViolationCount
          )}
          href={`/console/clients/${id}/violations`}
          linkText="View in Violations"
        />
        <SummaryLink
          title="Remediation"
          value="Operational vs challengeable work"
          body="Removability is separate from weighted burden; the queue estimates what can be acted on."
          href={`/console/clients/${id}/remediation`}
          linkText="View in Remediation"
        />
        <SummaryLink
          title="Cases"
          value={`${(dataqCount ?? 0) + (cpdpCount ?? 0)} total cases`}
          body={`${dataqCount ?? 0} DataQ and ${cpdpCount ?? 0} CPDP records are indexed in the Cases tab.`}
          href={`/console/clients/${id}/cases`}
          linkText="View in Cases"
        />
        <SummaryLink
          title="Monitoring"
          value={
            latestSnapshot
              ? `Baseline ${formatDate(latestSnapshot.snapshot_date)}`
              : "No snapshots yet"
          }
          body={
            latestSnapshot && previousSnapshot
              ? "Change tracking is active with at least two snapshots."
              : "Tracking begins once the next refresh creates a comparison snapshot."
          }
          href={`/console/clients/${id}/monitoring`}
          linkText="View monitoring"
        />
      </div>
    </div>
  );
}

function SnapshotStat({
  label,
  value,
  tooltip,
  subvalue,
  compact = false,
}: {
  label: string;
  value: unknown;
  tooltip?: string;
  subvalue?: string | null;
  compact?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#F0E8DA] p-4">
      <div className="flex items-center gap-0.5">
        <p className="text-xs text-gray-500">{label}</p>
        {tooltip && <Tooltip content={tooltip} />}
      </div>
      <p className={`${compact ? "text-sm" : "text-2xl"} font-bold text-[#1E1C1A] mt-1`}>
        {value != null && value !== "" ? String(value) : "\u2014"}
      </p>
      {subvalue && <p className="text-xs text-gray-400 mt-0.5">{subvalue}</p>}
    </div>
  );
}

function SummaryLink({
  title,
  value,
  body,
  href,
  linkText,
}: {
  title: string;
  value: string;
  body: string;
  href: string;
  linkText: string;
}) {
  return (
    <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
      <p className="text-sm font-semibold text-[#1E1C1A] mt-2">{value}</p>
      <p className="text-xs text-gray-500 mt-1 min-h-10">{body}</p>
      <Link href={href} className="text-xs text-[#C67A1E] hover:underline mt-3 inline-block">
        {linkText} {"\u2192"}
      </Link>
    </section>
  );
}
