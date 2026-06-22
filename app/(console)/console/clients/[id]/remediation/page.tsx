import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { scoreChallenge, type ChallengeScore } from "@/lib/analysis/challengeability-v2";
import { BASIC_LABELS, timeWeightFor } from "@/lib/analysis/basic-measure";
import { createClient } from "@/lib/supabase/server";
import { caseStatusLabel, caseStatusVariant, formatDate } from "@/lib/utils";

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
  convicted: boolean | null;
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

type LaneCItem = {
  violation: ViolationRow;
  basicCategory: string;
  points: number;
  challenge: ChallengeScore;
};

type LaneAItem = {
  lane: "A";
  crash: CrashRow;
  caseRow: CpdpCaseRow | null;
};

const OPERATIONAL_RECOMMENDATIONS: Record<string, string> = {
  vehicle_maintenance:
    "Address at the shop (tires, brakes, lighting, steering). Not DataQ-challengeable; decays out of the 24-month CSA window over time.",
  hos_compliance:
    "Driver HOS coaching / ELD discipline. Genuine logging errors that ARE challengeable appear under Priority actions; the rest age out over 24 months.",
  unsafe_driving:
    "Driver behavior coaching (speed management, following distance, seat-belt use). Not challengeable; decays over 24 months.",
  driver_fitness:
    "Complete/correct the driver qualification file. Ages out over 24 months.",
  hazmat_compliance:
    "HM compliance correction (marking, packaging, documentation). Ages out over 24 months.",
  controlled_substance: "Testing / program compliance. Ages out over 24 months.",
};

export default async function RemediationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, dot_number")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const [{ data: violations }, { data: crashes }, { data: dataqCases }, { data: cpdpCases }] =
    await Promise.all([
      supabase
        .from("violations")
        .select(
          "id, inspection_id, violation_code, violation_description, basic_category, severity_weight, oos_violation, citation_number, convicted, inspections(inspection_date, state)"
        )
        .eq("client_id", id),
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

  const queue = buildQueue(
    (violations ?? []) as unknown as ViolationRow[],
    (crashes ?? []) as unknown as CrashRow[],
    (dataqCases ?? []) as unknown as DataqCaseRow[],
    (cpdpCases ?? []) as unknown as CpdpCaseRow[]
  );

  const laneBPercent = queue.totalPoints > 0 ? Math.round((queue.laneBPoints / queue.totalPoints) * 100) : 0;
  const laneCPercent = queue.totalPoints > 0 ? Math.round((queue.laneCPoints / queue.totalPoints) * 100) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#C67A1E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#C67A1E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">Remediation</span>
      </div>

      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1E1C1A]">Remediation queue</h1>
            <p className="text-sm text-gray-500 mt-1">
              Total weighted violation burden:{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.totalPoints} pts</span>.
              {" "}Challengeable (DataQ):{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.laneBPoints} pts ({laneBPercent}%)</span>.
              {" "}Operational (not challengeable):{" "}
              <span className="font-semibold text-[#1E1C1A]">{queue.laneCPoints} pts ({laneCPercent}%)</span>.
              {" "}Plus <span className="font-semibold text-[#1E1C1A]">{queue.laneA.length}</span>{" "}
              crash{queue.laneA.length === 1 ? "" : "es"} flagged for CPDP review.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Most carriers&apos; burden is operational and reduces as violations age out of the 24-month window; only genuine data errors and crash-preventability are challengeable.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {queue.excludedCount > 0 && (
              <Badge variant="outline">
                {queue.excludedCount} aged out / unscored excluded
              </Badge>
            )}
            {queue.agedOutCrashCount > 0 && (
              <Badge variant="outline">
                {queue.agedOutCrashCount} crash{queue.agedOutCrashCount === 1 ? "" : "es"} aged out of the 24-month window
              </Badge>
            )}
          </div>
        </div>
      </div>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="p-5 border-b border-[#F0E8DA]">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Priority actions</h2>
          <p className="text-xs text-gray-500 mt-1">Crashes first, then moderate/strong DataQs candidates by point impact.</p>
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
                    No priority CPDP or DataQs actions.
                  </td>
                </tr>
              ) : (
                queue.priorityRows.map((item) =>
                  item.lane === "A" ? (
                    <tr key={`crash-${item.crash.id}`} className="bg-[#FBF7F0]">
                      <td className="px-5 py-4"><Badge variant="gold">A</Badge></td>
                      <td className="px-5 py-4 font-medium text-[#1E1C1A]">
                        Crash {formatDate(item.crash.crash_date)}
                        {item.crash.state ? ` · ${item.crash.state}` : ""}
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
                  ) : (
                    <tr key={`violation-${item.violation.id}`} className="bg-[#FBF7F0]">
                      <td className="px-5 py-4"><Badge variant="info">B</Badge></td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#1E1C1A]">{item.violation.violation_code}</div>
                        <div className="text-xs text-gray-500 max-w-sm truncate">{item.violation.violation_description}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-500">{item.basicLabel}</td>
                      <td className="px-5 py-4 font-semibold text-[#1E1C1A]">{item.points} pts</td>
                      <td className="px-5 py-4 text-gray-600">File DataQs challenge — {item.challenge.summary}</td>
                      <td className="px-5 py-4">{renderDataqStatus(item.caseRow)}</td>
                      <td className="px-5 py-4">
                        <Link className="text-[#C67A1E] hover:underline font-medium" href={`/console/clients/${id}/dataq`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="p-5 border-b border-[#F0E8DA]">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Operational burden (not challengeable)</h2>
          <p className="text-xs text-gray-500 mt-1">Lane C is not filed against FMCSA — the remedy is operational + time decay, and SafeScore monitors the decay.</p>
        </div>
        <div className="divide-y divide-[#F0E8DA]">
          {queue.operationalGroups.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No scored operational burden in the current window.</div>
          ) : (
            queue.operationalGroups.map((group) => (
              <div key={group.basicCategory} className="p-5 grid gap-3 md:grid-cols-[220px_1fr]">
                <div>
                  <div className="font-semibold text-[#1E1C1A] text-sm">{group.label}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {group.count} violation{group.count === 1 ? "" : "s"} · {group.points} pts
                  </div>
                </div>
                <p className="text-sm text-gray-600">{group.recommendation}</p>
              </div>
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
  cpdpCases: CpdpCaseRow[]
) {
  const dataqByViolation = new Map<string, DataqCaseRow>();
  for (const c of dataqCases) {
    if (c.violation_id && !dataqByViolation.has(c.violation_id)) {
      dataqByViolation.set(c.violation_id, c);
    }
  }

  const cpdpByCrash = new Map<string, CpdpCaseRow>();
  for (const c of cpdpCases) {
    if (c.crash_id && !cpdpByCrash.has(c.crash_id)) {
      cpdpByCrash.set(c.crash_id, c);
    }
  }

  const crashCutoff = new Date();
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
  const laneC: LaneCItem[] = [];
  let excludedCount = 0;

  for (const violation of violations) {
    const timeWeight = timeWeightFor(violation.inspections?.inspection_date ?? null, new Date());
    const points =
      violation.severity_weight != null && timeWeight > 0
        ? timeWeight * (violation.severity_weight + (violation.oos_violation ? 2 : 0))
        : 0;

    if (points <= 0 || violation.severity_weight == null || !violation.basic_category) {
      excludedCount += 1;
      continue;
    }

    const challenge = scoreChallenge({
      violationCode: violation.violation_code,
      basicCategory: violation.basic_category,
      severityWeight: violation.severity_weight,
      timeWeight,
      challengeReason: null,
      oosViolation: violation.oos_violation,
      convicted: violation.convicted,
      basicPercentile: null,
    });

    if (challenge.label === "strong" || challenge.label === "moderate") {
      laneB.push({
        lane: "B",
        violation,
        basicLabel: BASIC_LABELS[violation.basic_category] ?? violation.basic_category,
        points,
        challenge,
        caseRow: dataqByViolation.get(violation.id) ?? null,
      });
    } else {
      laneC.push({
        violation,
        basicCategory: violation.basic_category,
        points,
        challenge,
      });
    }
  }

  laneB.sort((a, b) => b.points - a.points || (b.violation.inspections?.inspection_date ?? "").localeCompare(a.violation.inspections?.inspection_date ?? ""));

  const operationalGroups = [...groupOperational(laneC).values()].sort(
    (a, b) => b.points - a.points || b.count - a.count
  );

  const laneBPoints = laneB.reduce((sum, item) => sum + item.points, 0);
  const laneCPoints = laneC.reduce((sum, item) => sum + item.points, 0);

  return {
    laneA,
    laneB,
    laneC,
    laneBPoints,
    laneCPoints,
    totalPoints: laneBPoints + laneCPoints,
    excludedCount,
    agedOutCrashCount,
    priorityRows: [...laneA, ...laneB],
    operationalGroups,
  };
}

function groupOperational(items: LaneCItem[]) {
  const groups = new Map<
    string,
    { basicCategory: string; label: string; count: number; points: number; recommendation: string }
  >();

  for (const item of items) {
    const current = groups.get(item.basicCategory) ?? {
      basicCategory: item.basicCategory,
      label: BASIC_LABELS[item.basicCategory] ?? item.basicCategory,
      count: 0,
      points: 0,
      recommendation:
        OPERATIONAL_RECOMMENDATIONS[item.basicCategory] ??
        "Operational correction. Ages out over 24 months.",
    };
    current.count += 1;
    current.points += item.points;
    groups.set(item.basicCategory, current);
  }

  return groups;
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
