import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { BurdenSparkline } from "@/components/portal/burden-sparkline";
import { BasicPressureList } from "@/components/portal/basic-pressure-list";
import { loadPortalHomePressureDetails } from "@/lib/portal/home-server";
import { preferredAuthorityStatus } from "@/lib/portal/home";
import { AuthorityInsuranceSection, type CarrierProfileEnrichmentRow } from "@/components/console/authority-insurance-section";
import { Mcs150TruthUpSection } from "@/components/console/mcs150-truth-up-section";
import { FmcsaAccessBadge } from "@/components/console/fmcsa-access-badge";
import { FmcsaPinRequestControl } from "@/components/console/fmcsa-pin-request-control";
import { RunAnalysisButton } from "@/components/console/run-analysis-button";
import { ChallengeabilityAnalysisButton } from "@/components/console/challengeability-analysis-button";
import { FmcsaExportUpload } from "@/components/console/fmcsa-export-upload";
import { normalizeClientTier, tierBadgeVariant, tierDisplayLabel, tierHasFeature } from "@/lib/tiers";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
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



  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
  const cutoff24mo = (parseInt(today.slice(0, 4)) - 2).toString() + today.slice(4);
  const scopePromise = getCanonicalInspectionScope(id, supabase);
  const violationCountQuery = supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);

  const [
    { data: client, error: clientError },
    { data: carrierProfile },
    { data: crashRows },
    { count: violationCount },
    { count: dataqCount },
    { count: cpdpCount },
    reconciliation,
    monitoringSnapshots,
    enrichmentResult, pinResult, pinRequestResult, unassessedResult,
  ] = await Promise.all([
    supabase
    .from("clients")
    .select("id, name, dot_number, mc_number, tier, driver_count, fmcsa_authorized")
    .eq("id", id)
    .single(),
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
    scopePromise.then(({ inspectionIds }) => violationCountQuery.in("inspection_id", inspectionIds)),
    supabase.from("dataq_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("cpdp_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
    getClientBasicReconciliation(id),
    getRecentSnapshots(id, 12),
    supabase.from("carrier_profile_enrichments").select("id,client_id,source,source_url,source_as_of,fetched_at,currentness,data,parser_version,created_at,updated_at").eq("client_id", id).order("fetched_at", { ascending: false }),
    supabase.from("client_credentials").select("id", { count: "exact", head: true }).eq("client_id", id).not("fmcsa_pin_encrypted", "is", null),
    supabase.from("client_requests").select("id").eq("client_id", id).eq("category", "fmcsa_portal_pin").eq("status", "open").limit(1).maybeSingle(),
    scopePromise.then(({ inspectionIds }) => supabase.from("violations").select("id", { count: "exact", head: true }).eq("client_id", id).in("inspection_id", inspectionIds).is("ai_assessed_at", null)),
  ]);

  if (clientError && clientError.code !== "PGRST116") throw new Error(`Unable to load client profile: ${clientError.message}`);
  if (!client) notFound();

  for (const [label, result] of [["enrichment", enrichmentResult], ["PIN status", pinResult], ["PIN request", pinRequestResult], ["unassessed violations", unassessedResult]] as const) if (result.error) throw new Error(`Unable to load profile ${label}: ${result.error.message}`);
  const tier = normalizeClientTier(client.tier);
  const enrichmentRows = (enrichmentResult.data ?? []) as unknown as CarrierProfileEnrichmentRow[];
  const motus = enrichmentRows.find(row => row.source === "fmcsa_motus");
  const authority = motus && Array.isArray(motus.data.authorities) ? preferredAuthorityStatus(motus.data.authorities) : null;
  const filings = motus && Array.isArray(motus.data.insuranceFilings) ? motus.data.insuranceFilings.length : null;
  const cp = carrierProfile as Record<string, unknown> | null;
  const crashes = (crashRows ?? []) as CrashRow[];
  const burden = reconciliation.burden;
  const storySentences = buildStoryStrip(burden, crashes);
  const latestSnapshot = monitoringSnapshots[0] ?? null;
  const previousSnapshot = monitoringSnapshots[1] ?? null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-8">
      <header className="portal-navy-texture overflow-hidden rounded-2xl p-6 text-warm-white sm:p-8">
        <p className="font-mono text-xs uppercase tracking-widest text-gold-light">Carrier profile · USDOT {client.dot_number}{client.mc_number ? ` · MC ${client.mc_number}` : ""}</p>
        <h1 className="mt-3 font-heading text-3xl sm:text-5xl">{client.name}</h1>
        <div className="mt-4 flex flex-wrap gap-2"><Badge variant={tierBadgeVariant(tier)}>{tierDisplayLabel(client.tier)}</Badge><Badge variant="info">Stored authority: {authority ?? "Not recorded"}</Badge><Badge variant="info">{filings == null ? "Insurance filings not recorded" : `${filings} insurance filings on record`}</Badge></div>
        {motus && <p className="mt-2 text-xs text-warm-white/65">FMCSA source as of {formatDate(motus.source_as_of ?? motus.fetched_at)} · {motus.currentness}. Filing records do not establish current coverage.</p>}
        <div className="mt-7 grid gap-6 lg:grid-cols-2"><div><p className="text-sm text-warm-white/75">In-window weighted burden</p><p className="mt-1 font-heading text-6xl text-gold-light">{burden.totalPoints.toLocaleString()}</p><p className="mt-3 text-sm text-warm-white/75">{latestSnapshot && previousSnapshot ? latestSnapshot.total_points === previousSnapshot.total_points ? "Unchanged since the previous snapshot" : `${latestSnapshot.total_points - previousSnapshot.total_points > 0 ? "+" : ""}${latestSnapshot.total_points - previousSnapshot.total_points} points since the previous snapshot` : "Comparison begins with the next snapshot"}</p><p className="mt-2 font-mono text-xs text-warm-white/65">Calculated as of {formatDate(burden.asOf)}</p></div><BurdenSparkline label="Recorded burden trend" snapshots={[...monitoringSnapshots].reverse().map(row => ({ id: row.id, capturedAt: row.captured_at, snapshotDate: row.snapshot_date, source: row.source, totalPoints: row.total_points }))} /></div>
        <p className="mt-6 max-w-3xl text-sm text-warm-white/75">FMCSA does not publish public percentile rankings for low-volume carriers; this is the corrected weighted burden in the 24-month window.</p>
        <div className="mt-6 flex flex-wrap items-start gap-3"><RunAnalysisButton clientId={id} dotNumber={client.dot_number} hasData={(violationCount ?? 0) > 0} hasFmcsaAccess={client.fmcsa_authorized === true} /><ChallengeabilityAnalysisButton clientId={id} totalCount={violationCount ?? 0} unassessedCount={unassessedResult.count ?? 0} /><FmcsaExportUpload clientId={id} dotNumber={client.dot_number} /></div>
      </header>
      <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm"><h2 className="font-heading text-2xl text-navy">BASIC pressure</h2><p className="mt-2 text-sm text-warm-mid">{formatViolationWindowSummary(violationCount ?? 0, reconciliation.queryTrace.inWindowViolationCount)}</p><Suspense fallback={<p className="py-8 text-sm text-warm-mid">Loading pressure details…</p>}><ProfilePressure clientId={id} tier={tier} asOf={burden.asOf} basics={burden.perBasic.map(row => ({ basic_category: row.basicCategory, violation_count: row.violationCount, weighted_points: row.weightedPoints }))} totalPoints={burden.totalPoints} /></Suspense></section>
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
          <h2 className="font-heading text-2xl text-navy mb-4">Carrier snapshot</h2>
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

      <details className="rounded-xl border border-sand bg-warm-white overflow-x-auto"><summary className="min-h-11 cursor-pointer p-5 font-heading text-xl text-navy">Detailed point reconciliation</summary><section>
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

      </details>
      <AuthorityInsuranceSection clientId={id} billingDriverCount={client.driver_count ?? null} rows={enrichmentRows} />
      <section className="rounded-xl border border-sand bg-warm-white p-5"><h2 className="font-heading text-2xl text-navy">FMCSA access</h2><div className="mt-4 flex flex-wrap items-center gap-3"><FmcsaAccessBadge hasAccess={client.fmcsa_authorized === true} /><Badge variant={(pinResult.count ?? 0) > 0 ? "success" : "warning"}>{(pinResult.count ?? 0) > 0 ? "Portal PIN on file" : "Portal PIN needed"}</Badge><FmcsaPinRequestControl clientId={id} requestAlreadyOpen={!!pinRequestResult.data} /></div></section>
      {tierHasFeature(tier, "truth_up_service") ? <Mcs150TruthUpSection clientId={id} /> : <TierUpgradeNote feature="truth_up_service" currentTier={tier} title="MCS-150 review" headingLevel="h2" />}

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
          href={`/console/clients/${id}/plan`}
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
          href={`/console/clients/${id}/work#monitoring`}
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

async function ProfilePressure({ clientId, tier, asOf, basics, totalPoints }: { clientId: string; tier: ReturnType<typeof normalizeClientTier>; asOf: string; basics: import("@/lib/portal/home").PortalHomeBasic[]; totalPoints: number }) {
  const details = await loadPortalHomePressureDetails({ clientId, tier, snapshotCapturedAt: asOf });
  return <BasicPressureList basics={basics} details={details} totalPoints={totalPoints} planHref={`/console/clients/${clientId}/plan`} />;
}
