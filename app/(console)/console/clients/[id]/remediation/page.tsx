import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { scoreChallenge, type ChallengeScore } from "@/lib/analysis/challengeability-v2";
import { evidenceRequirementsForViolation } from "@/lib/analysis/evidence-requirements";
import { BASIC_LABELS, timeWeightFor } from "@/lib/analysis/basic-measure";
import { createClient } from "@/lib/supabase/server";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { normalizeClientTier } from "@/lib/tiers";
import { caseStatusLabel, caseStatusVariant, formatDate } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { getRemediationNextStep } from "@/lib/analysis/remediation-next-step";
import { summarizeInvestigationBurden } from "@/lib/analysis/remediation-presentation";
import { buildLaneCFamilyGroups } from "@/lib/playbooks/families";
import { FAMILY_DEFINITIONS } from "@/lib/playbooks/templates";

export const dynamic = "force-dynamic";

type ViolationRow = {
  id: string;
  inspection_id: string;
  violation_code: string;
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean;
  citation_number: string | null;
  citation_result: string | null;
  convicted: boolean | null;
  challenge_reason: string | null;
  challenge_tier: "strong" | "moderate" | "investigate" | "not_challengeable" | "operational" | null;
  inspections: { inspection_date: string | null; state: string | null } | null;
};

type CrashRow = {
  id: string;
  crash_date: string | null;
  state: string | null;
  city?: string | null;
  tow_away?: boolean | null;
  injuries?: number | null;
  fatalities?: number | null;
};

type DataqCaseRow = {
  id: string;
  violation_id: string | null;
  inspection_id: string | null;
  status: string;
  case_number: string | null;
};

type DataqEvidenceRow = {
  case_id: string;
  acquisition_method: string | null;
};

type EvidenceSummary = {
  auto: number;
  client: number;
  manual: number;
  total: number;
};

type CpdpCaseRow = {
  id: string;
  crash_id: string | null;
  status: string;
  case_number?: string | null;
};

type LaneBItem = {
  lane: "B";
  violation: ViolationRow;
  basicLabel: string;
  points: number;
  challenge: ChallengeScore;
  caseRow: DataqCaseRow | null;
};

type LaneInvestigateItem = {
  lane: "I";
  violation: ViolationRow;
  basicLabel: string;
  points: number;
  challenge: ChallengeScore;
  caseRow: DataqCaseRow | null;
  evidenceSummary: EvidenceSummary;
};

type LaneCItem = {
  lane: "C";
  violation: ViolationRow;
  basicCategory: string;
  basicLabel: string;
  points: number;
  challenge: ChallengeScore;
};

type LaneAItem = {
  lane: "A";
  crash: CrashRow;
  caseRow: CpdpCaseRow | null;
};

type RemediationSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function loadCanonicalViolations(
  supabase: RemediationSupabaseClient,
  clientId: string,
  canonicalInspectionIds: string[]
): Promise<ViolationRow[]> {
  const countResult = await supabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (countResult.error) {
    throw new Error(
      `Unable to count remediation violations: ${countResult.error.message}`
    );
  }

  const expectedCount = countResult.count ?? 0;
  const rows: ViolationRow[] = [];
  const pageSize = 1_000;
  while (rows.length < expectedCount) {
    const pageResult = await supabase
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, basic_category, severity_weight, oos_violation, citation_number, citation_result, convicted, challenge_reason, challenge_tier, inspections(inspection_date, state)"
      )
      .eq("client_id", clientId)
      .order("id", { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);
    if (pageResult.error) {
      throw new Error(
        `Unable to load remediation violations: ${pageResult.error.message}`
      );
    }
    const page = (pageResult.data ?? []) as unknown as ViolationRow[];
    if (page.length === 0) {
      throw new Error(
        `Unable to load remediation violations: expected ${expectedCount} rows but received ${rows.length}.`
      );
    }
    rows.push(...page);
  }

  const canonical = new Set(canonicalInspectionIds);
  return rows.filter((row) => canonical.has(row.inspection_id));
}

export default async function RemediationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, dot_number, tier")
    .eq("id", id)
    .single();

  if (clientError && clientError.code !== "PGRST116") {
    throw new Error(`Unable to load remediation client: ${clientError.message}`);
  }
  if (!client) notFound();
  const clientTier = normalizeClientTier(client.tier);

  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(id, supabase);

  const [
    violations,
    crashesResult,
    dataqCasesResult,
    cpdpCasesResult,
  ] = await Promise.all([
    loadCanonicalViolations(supabase, id, canonicalInspectionIds),
    supabase
      .from("crashes")
      .select("id, crash_date, state, city, tow_away, injuries, fatalities")
      .eq("client_id", id)
      .order("crash_date", { ascending: false }),
    supabase
      .from("dataq_cases")
      .select("id, violation_id, inspection_id, status, case_number")
      .eq("client_id", id),
    supabase
      .from("cpdp_cases")
      .select("id, crash_id, status, case_number")
      .eq("client_id", id),
  ]);

  for (const [label, error] of [
    ["crashes", crashesResult.error],
    ["DataQ cases", dataqCasesResult.error],
    ["CPDP cases", cpdpCasesResult.error],
  ] as const) {
    if (error) {
      throw new Error(`Unable to load remediation ${label}: ${error.message}`);
    }
  }
  const crashes = crashesResult.data;
  const dataqCases = dataqCasesResult.data;
  const cpdpCases = cpdpCasesResult.data;

  const dataqCaseIds = (dataqCases ?? []).map((caseRow) => caseRow.id);
  const dataqEvidenceResult = dataqCaseIds.length
    ? await supabase
        .from("dataq_evidence")
        .select("case_id, acquisition_method")
        .in("case_id", dataqCaseIds)
    : { data: [], error: null };
  if (dataqEvidenceResult.error) {
    throw new Error(
      `Unable to load remediation DataQ evidence: ${dataqEvidenceResult.error.message}`
    );
  }
  const dataqEvidence = dataqEvidenceResult.data;

  const violationRows = (violations ?? []) as unknown as ViolationRow[];
  const asOf = new Date();
  asOf.setUTCHours(0, 0, 0, 0);
  const queue = buildQueue(
    violationRows,
    (crashes ?? []) as unknown as CrashRow[],
    (dataqCases ?? []) as unknown as DataqCaseRow[],
    (cpdpCases ?? []) as unknown as CpdpCaseRow[],
    (dataqEvidence ?? []) as unknown as DataqEvidenceRow[],
    asOf
  );
  const laneCFamilyGroups = buildLaneCFamilyGroups(
    violationRows.map((violation) => ({
      id: violation.id,
      violation_code: violation.violation_code,
      violation_description: violation.violation_description,
      basic_category: violation.basic_category,
      severity_weight: violation.severity_weight,
      oos_violation: violation.oos_violation,
      citation_number: violation.citation_number,
      citation_result: violation.citation_result,
      convicted: violation.convicted,
      challenge_reason: violation.challenge_reason,
      challenge_tier: violation.challenge_tier,
      inspection_date: violation.inspections?.inspection_date ?? null,
    })),
    { asOf, trailingWindowDays: 90 }
  );

  const laneBPercent = queue.totalPoints > 0 ? Math.round((queue.laneBPoints / queue.totalPoints) * 100) : 0;
  const laneCPercent = queue.totalPoints > 0 ? Math.round((queue.laneCPoints / queue.totalPoints) * 100) : 0;
  const investigationSummary = summarizeInvestigationBurden(
    queue.laneInvestigate,
    queue.totalPoints
  );
  const openCaseCount = [...(dataqCases ?? []), ...(cpdpCases ?? [])].filter(
    (caseRow) => !["won", "lost", "closed", "withdrawn"].includes(caseRow.status)
  ).length;
  const nextStep = getRemediationNextStep({
    safetyRecordCount: (violations ?? []).length + (crashes ?? []).length,
    actionCount: queue.priorityRows.length + laneCFamilyGroups.length,
    openCaseCount,
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1E1C1A]">Remediation queue</h1>
            <p className="text-sm text-gray-500 mt-1">
              In-window weighted violation burden:{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.totalPoints} pts</span>.
              {" "}Estimated points removable if successfully challenged:{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.laneBPoints} pts ({laneBPercent}%)</span>.
              {" "}Operational burden that needs coaching, maintenance, or time decay:{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.laneCPoints} pts ({laneCPercent}%)</span>.
              {" "}Plus <span className="font-semibold text-[#1E1C1A]">{queue.laneA.length}</span>{" "}
              crash{queue.laneA.length === 1 ? "" : "es"} flagged for CPDP review.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Most carriers&apos; burden is operational and reduces as violations age out of the 24-month window; only genuine data errors and crash-preventability are challengeable.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Under investigation:{" "}
              <span className="font-semibold text-[#1E1C1A]">
                {investigationSummary.points} pts ({investigationSummary.percent}%)
              </span>{" "}
              across {investigationSummary.violationCount} violation
              {investigationSummary.violationCount === 1 ? "" : "s"}
              {" \u2014 evidence pending."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <ServiceTierChip tier={clientTier} feature="playbook_coach" />
            {queue.excludedCount > 0 && (
              <Badge variant="outline">
                {queue.excludedCount} violations not counted in the score
                <Tooltip
                  content={`Excluded because they're older than 24 months, have no severity score, or have no BASIC category. ${queue.countedCount} counted + ${queue.excludedCount} excluded = ${queue.countedCount + queue.excludedCount} total.`}
                  position="bottom"
                />
              </Badge>
            )}
            {queue.agedOutCrashCount > 0 && (
              <Badge variant="outline">
                {queue.agedOutCrashCount} crash{queue.agedOutCrashCount === 1 ? "" : "es"} too old to count (over 24 months)
              </Badge>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border-2 border-[#C67A1E]/40 bg-gradient-to-br from-[#FFF8EA] via-white to-[#FBF7F0] p-6 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8B5E2B]">What next</p>
              <Badge variant="outline">{nextStep.label}</Badge>
            </div>
            <h2 className="mt-2 text-xl font-bold text-[#1E1C1A]">{nextStep.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{nextStep.detail}</p>
          </div>
          <Link
            href={`/console/clients/${id}${nextStep.hrefSuffix}`}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#C67A1E] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B86E18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C67A1E] focus-visible:ring-offset-2"
          >
            {nextStep.action} &rarr;
          </Link>
        </div>
        <div className="mt-5 grid gap-2 border-t border-[#EAD8BC] pt-4 text-xs md:grid-cols-3">
          <div className="rounded-lg bg-white/70 border border-[#F0E8DA] p-3">
            <p className="font-semibold text-[#1E1C1A]">Lane A - CPDP</p>
            <p className="text-gray-500 mt-1">Review eligible crashes for documented non-preventability.</p>
          </div>
          <div className="rounded-lg bg-white/70 border border-[#F0E8DA] p-3">
            <p className="font-semibold text-[#1E1C1A]">Lane B - DataQs</p>
            <p className="text-gray-500 mt-1">File only genuinely erroneous violations supported by actual evidence. Investigate means evidence is needed, not that the violation is removable.</p>
          </div>
          <div className="rounded-lg bg-white/70 border border-[#F0E8DA] p-3">
            <p className="font-semibold text-[#1E1C1A]">Lane C - operational fixes</p>
            <p className="text-gray-500 mt-1">Correct legitimate safety issues and monitor their 24-month age-out.</p>
          </div>
        </div>
      </section>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="p-5 border-b border-[#F0E8DA]">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Case and evidence action queue</h2>
          <p className="text-xs text-gray-500 mt-1">Lanes A, I, and B stay item-level for crash review, evidence investigation, and genuine challenge filings. Lane C coaching and shop work is grouped by root-cause family below.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/60 text-xs text-gray-500">
              <tr>
                <th className="text-left font-medium px-5 py-3">Lane</th>
                <th className="text-left font-medium px-5 py-3">Item</th>
                <th className="text-left font-medium px-5 py-3">BASIC</th>
                <th className="text-left font-medium px-5 py-3">Point-impact</th>
                <th className="text-left font-medium px-5 py-3">Recommended action</th>
                <th className="text-left font-medium px-5 py-3">Status</th>
                <th className="text-left font-medium px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {queue.priorityRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                    No item-level CPDP, evidence, or DataQs actions.
                  </td>
                </tr>
              ) : (
                queue.priorityRows.map((item) =>
                  item.lane === "A" ? (
                    <tr key={`crash-${item.crash.id}`} className="bg-[#FBF7F0]">
                      <td className="px-5 py-4"><Badge variant="gold">A</Badge></td>
                      <td className="px-5 py-4 font-medium text-[#1E1C1A]">
                        Crash {formatDate(item.crash.crash_date)}
                        {item.crash.state ? ` \u00B7 ${item.crash.state}` : ""}
                      </td>
                      <td className="px-5 py-4 text-gray-500">Crash Indicator</td>
                      <td className="px-5 py-4 text-gray-500">crash</td>
                      <td className="px-5 py-4 text-gray-600">Review for CPDP (crash preventability)</td>
                      <td className="px-5 py-4">{renderCpdpStatus(item.caseRow)}</td>
                      <td className="px-5 py-4">
                        <Link className="text-[#C67A1E] hover:underline font-medium" href={item.caseRow ? `/console/clients/${id}/cpdp/${item.caseRow.id}` : `/console/clients/${id}/cpdp`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ) : item.lane === "I" ? (
                    <tr key={`investigate-${item.violation.id}`} className="bg-[#FBF7F0]">
                      <td className="px-5 py-4"><Badge variant="warning">I</Badge></td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#1E1C1A]">{item.violation.violation_code}</div>
                        <div className="text-xs text-gray-500 max-w-sm truncate">{item.violation.violation_description}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-500">{item.basicLabel}</td>
                      <td className="px-5 py-4 font-semibold text-[#1E1C1A]">{item.points} pts</td>
                      <td className="px-5 py-4 text-gray-600">
                        Investigate evidence - Auto {item.evidenceSummary.auto} / Client {item.evidenceSummary.client} / Manual {item.evidenceSummary.manual}
                      </td>
                      <td className="px-5 py-4">{renderDataqStatus(item.caseRow)}</td>
                      <td className="px-5 py-4">
                        <Link className="text-[#C67A1E] hover:underline font-medium" href={item.caseRow ? `/console/clients/${id}/dataq?case=${item.caseRow.id}` : `/console/clients/${id}/violations`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ) : item.lane === "B" ? (
                    <tr key={`violation-${item.violation.id}`} className="bg-[#FBF7F0]">
                      <td className="px-5 py-4"><Badge variant="info">B</Badge></td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#1E1C1A]">{item.violation.violation_code}</div>
                        <div className="text-xs text-gray-500 max-w-sm truncate">{item.violation.violation_description}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-500">{item.basicLabel}</td>
                      <td className="px-5 py-4 font-semibold text-[#1E1C1A]">{item.points} pts</td>
                      <td className="px-5 py-4 text-gray-600">File DataQs challenge - {item.challenge.summary}</td>
                      <td className="px-5 py-4">{renderDataqStatus(item.caseRow)}</td>
                      <td className="px-5 py-4">
                        <Link className="text-[#C67A1E] hover:underline font-medium" href={item.caseRow ? `/console/clients/${id}/dataq?case=${item.caseRow.id}` : `/console/clients/${id}/violations`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ) : null
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white/60">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-gray-600">Lane C family programs</h2>
              <ServiceTierChip tier={clientTier} feature="playbook_coach" />
            </div>
            <p className="mt-1 text-xs text-gray-400">Operational burden is grouped at the root-cause level. The remedy is coaching, maintenance, and stopping new inflow while SafeScore monitors the 24-month decay.</p>
          </div>
          <Link
            href={`/console/clients/${id}/remediation/playbook`}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[#DCCCB5] bg-white px-3 py-2 text-xs font-semibold text-[#8B5E2B] transition-colors hover:border-[#C67A1E] hover:bg-[#FDF4E7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C67A1E] focus-visible:ring-offset-2"
          >
            Open safety playbook &rarr;
          </Link>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {laneCFamilyGroups.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No scored operational burden in the current window.</div>
          ) : (
            laneCFamilyGroups.map((group) => (
              <article
                key={group.familyKey}
                className="rounded-xl border border-[#F0E8DA] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{group.familyCode}</Badge>
                      {group.familyKey === "general_safety" && (
                        <Badge variant="warning">Mapping review needed</Badge>
                      )}
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-[#1E1C1A]">
                      {group.familyName}
                    </h3>
                  </div>
                  <Link
                    href={`/console/clients/${id}/remediation/playbook#program-${group.familyKey}`}
                    className="shrink-0 text-xs font-semibold text-[#C67A1E] hover:underline"
                  >
                    Open program
                  </Link>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-[#FBF7F0] p-2.5">
                    <dt className="text-[10px] text-gray-400">Violations</dt>
                    <dd className="mt-0.5 text-sm font-bold text-[#1E1C1A]">
                      {group.count}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-[#FBF7F0] p-2.5">
                    <dt className="text-[10px] text-gray-400">Current points</dt>
                    <dd className="mt-0.5 text-sm font-bold text-[#1E1C1A]">
                      {group.points}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-[#FBF7F0] p-2.5">
                    <dt className="text-[10px] text-gray-400">90-day inflow</dt>
                    <dd className="mt-0.5 text-sm font-bold text-[#1E1C1A]">
                      {group.inflowRatePerMonth.toFixed(2)}/mo
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-gray-500">
                  {FAMILY_DEFINITIONS[group.familyKey].riskContext}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function buildQueue(
  violations: ViolationRow[],
  crashes: CrashRow[],
  dataqCases: DataqCaseRow[],
  cpdpCases: CpdpCaseRow[],
  dataqEvidence: DataqEvidenceRow[],
  asOf: Date
) {
  const dataqByViolation = new Map<string, DataqCaseRow>();
  for (const c of dataqCases) {
    if (c.violation_id && !dataqByViolation.has(c.violation_id)) {
      dataqByViolation.set(c.violation_id, c);
    }
  }

  const evidenceByCase = new Map<string, EvidenceSummary>();
  for (const row of dataqEvidence) {
    const current = evidenceByCase.get(row.case_id) ?? emptyEvidenceSummary();
    incrementEvidenceSummary(current, row.acquisition_method);
    evidenceByCase.set(row.case_id, current);
  }

  const cpdpByCrash = new Map<string, CpdpCaseRow>();
  for (const c of cpdpCases) {
    if (c.crash_id && !cpdpByCrash.has(c.crash_id)) {
      cpdpByCrash.set(c.crash_id, c);
    }
  }

  const crashCutoff = new Date(asOf);
  crashCutoff.setMonth(crashCutoff.getMonth() - 24);

  let agedOutCrashCount = 0;
  const laneA: LaneAItem[] = [...crashes]
    .sort((a, b) => (b.crash_date ?? "").localeCompare(a.crash_date ?? ""))
    .flatMap((crash) => {
      const caseRow = cpdpByCrash.get(crash.id) ?? null;
      const crashDate = crash.crash_date ? new Date(crash.crash_date + "T00:00:00") : null;
      const inWindow = !crashDate || Number.isNaN(crashDate.getTime()) || crashDate >= crashCutoff;

      if (!inWindow && !caseRow) {
        agedOutCrashCount += 1;
        return [];
      }

      return [{ lane: "A" as const, crash, caseRow }];
    });

  const laneB: LaneBItem[] = [];
  const laneInvestigate: LaneInvestigateItem[] = [];
  const laneC: LaneCItem[] = [];
  let excludedCount = 0;
  let countedCount = 0;

  for (const violation of violations) {
    const timeWeight = timeWeightFor(violation.inspections?.inspection_date ?? null, asOf);
    const points =
      violation.severity_weight != null && timeWeight > 0
        ? timeWeight * (violation.severity_weight + (violation.oos_violation ? 2 : 0))
        : 0;

    const counted = points > 0 && violation.severity_weight != null && Boolean(violation.basic_category);
    if (counted) countedCount += 1;
    else excludedCount += 1;

    const challenge = scoreChallenge({
      violationCode: violation.violation_code,
      basicCategory: violation.basic_category,
      severityWeight: violation.severity_weight,
      timeWeight,
      challengeReason: violation.challenge_reason,
      oosViolation: violation.oos_violation,
      convicted: violation.convicted,
      citationNumber: violation.citation_number,
      citationResult: violation.citation_result,
      challengeTier: violation.challenge_tier,
      basicPercentile: null,
    });

    const basicLabel = violation.basic_category
      ? BASIC_LABELS[violation.basic_category] ?? violation.basic_category
      : "Uncategorized";

    if (challenge.label === "strong" || challenge.label === "moderate") {
      laneB.push({
        lane: "B",
        violation,
        basicLabel,
        points,
        challenge,
        caseRow: dataqByViolation.get(violation.id) ?? null,
      });
    } else if (challenge.label === "investigate") {
      const caseRow = dataqByViolation.get(violation.id) ?? null;
      const generatedSummary = evidenceRequirementsSummary(
        evidenceRequirementsForViolation(
          {
            violationCode: violation.violation_code,
            violationDescription: violation.violation_description,
            basicCategory: violation.basic_category,
            citationNumber: violation.citation_number,
            citationResult: violation.citation_result,
            challengeReason: violation.challenge_reason,
          },
          challenge
        )
      );
      laneInvestigate.push({
        lane: "I",
        violation,
        basicLabel,
        points,
        challenge,
        caseRow,
        evidenceSummary: caseRow ? evidenceByCase.get(caseRow.id) ?? generatedSummary : generatedSummary,
      });
    } else {
      laneC.push({
        lane: "C",
        violation,
        basicCategory: violation.basic_category ?? "uncategorized",
        basicLabel,
        points,
        challenge,
      });
    }
  }

  laneB.sort((a, b) => b.points - a.points || (b.violation.inspections?.inspection_date ?? "").localeCompare(a.violation.inspections?.inspection_date ?? ""));
  laneInvestigate.sort((a, b) => b.points - a.points || (b.violation.inspections?.inspection_date ?? "").localeCompare(a.violation.inspections?.inspection_date ?? ""));
  laneC.sort((a, b) => b.points - a.points || (b.violation.inspections?.inspection_date ?? "").localeCompare(a.violation.inspections?.inspection_date ?? ""));

  const laneBPoints = laneB.reduce((sum, item) => sum + item.points, 0);
  const laneInvestigatePoints = laneInvestigate.reduce((sum, item) => sum + item.points, 0);
  const laneCPoints = laneC.reduce((sum, item) => sum + item.points, 0);

  const priorityRows = [...laneA, ...laneInvestigate, ...laneB].sort(compareQueueItems);

  return {
    laneA,
    laneB,
    laneInvestigate,
    laneC,
    laneBPoints,
    laneInvestigatePoints,
    laneCPoints,
    totalPoints: laneBPoints + laneInvestigatePoints + laneCPoints,
    countedCount,
    excludedCount,
    agedOutCrashCount,
    priorityRows,
  };
}

type QueueItem = LaneAItem | LaneBItem | LaneInvestigateItem | LaneCItem;

function queueImpact(item: QueueItem) {
  return "points" in item ? item.points : 0;
}

function compareQueueItems(a: QueueItem, b: QueueItem) {
  const impactDelta = queueImpact(b) - queueImpact(a);
  if (impactDelta !== 0) return impactDelta;

  const laneOrder: Record<QueueItem["lane"], number> = { A: 0, B: 1, I: 2, C: 3 };
  const laneDelta = laneOrder[a.lane] - laneOrder[b.lane];
  if (laneDelta !== 0) return laneDelta;

  const aDate = "violation" in a ? a.violation.inspections?.inspection_date : a.crash.crash_date;
  const bDate = "violation" in b ? b.violation.inspections?.inspection_date : b.crash.crash_date;
  return (bDate ?? "").localeCompare(aDate ?? "");
}

function emptyEvidenceSummary(): EvidenceSummary {
  return { auto: 0, client: 0, manual: 0, total: 0 };
}

function incrementEvidenceSummary(summary: EvidenceSummary, method: string | null) {
  if (method === "auto") summary.auto += 1;
  else if (method === "client") summary.client += 1;
  else summary.manual += 1;
  summary.total += 1;
}

function evidenceRequirementsSummary(
  requirements: ReturnType<typeof evidenceRequirementsForViolation>
): EvidenceSummary {
  const summary = emptyEvidenceSummary();
  for (const item of requirements) {
    incrementEvidenceSummary(summary, item.acquisitionMethod);
  }
  return summary;
}

function renderDataqStatus(caseRow: DataqCaseRow | null) {
  if (!caseRow) return <Badge variant="outline">Not started</Badge>;
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={caseStatusVariant(caseRow.status)}>{caseStatusLabel(caseRow.status)}</Badge>
      {caseRow.case_number && <span className="text-xs text-gray-400">{caseRow.case_number}</span>}
    </div>
  );
}

function renderCpdpStatus(caseRow: CpdpCaseRow | null) {
  if (!caseRow) return <Badge variant="outline">Not started</Badge>;
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={cpdpStatusVariant(caseRow.status)}>{cpdpStatusLabel(caseRow.status)}</Badge>
      {caseRow.case_number && <span className="text-xs text-gray-400">{caseRow.case_number}</span>}
    </div>
  );
}

function cpdpStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    filed: "Filed / Pending FMCSA",
    pending: "Filed / Pending FMCSA",
    determination_made: "Determination made",
    closed: "Closed",
  };
  return labels[status] ?? status;
}

function cpdpStatusVariant(status: string): "default" | "info" | "warning" | "success" | "danger" | "outline" | "gold" {
  const variants: Record<string, "default" | "info" | "warning" | "success" | "danger" | "outline" | "gold"> = {
    draft: "gold",
    filed: "info",
    pending: "info",
    determination_made: "success",
    closed: "default",
  };
  return variants[status] ?? "default";
}
