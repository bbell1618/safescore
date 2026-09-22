import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { countViolationTiers } from "@/lib/analysis/violation-list";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import type { ViolationRow } from "@/components/console/violation-analyzer";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ViolationAnalyzer } from "@/components/console/violation-analyzer";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

export const dynamic = "force-dynamic";

function isOpenCase(kind: "CPDP" | "DataQ", status: string | null | undefined) {
  if (!status) return false;
  if (kind === "CPDP") return status === "filed" || status === "pending";
  return status === "investigating" || status === "filed" || status === "pending_state" || status === "pending_fmcsa" || status === "reconsidering";
}

export default async function ViolationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : "";
  const filters = { basic: value("basic") || "all", severity: value("severity") || "all", tier: value("tier") || "all", from: /^\d{4}-\d{2}-\d{2}$/.test(value("from")) ? value("from") : "", to: /^\d{4}-\d{2}-\d{2}$/.test(value("to")) ? value("to") : "", q: value("q") };
  const supabase = await createClient();



  const scopedViolationsQuery = getCanonicalInspectionScope(id, supabase).then(({ inspectionIds }) => {
  let violationsQuery = supabase
    .from("violations")
    .select("*, inspections!inner(inspection_date, state, level, facility_name, report_number)")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
    if (filters.basic !== "all") violationsQuery = violationsQuery.eq("basic_category", filters.basic);
    if (filters.severity === "8plus") violationsQuery = violationsQuery.gte("severity_weight", 8);
    if (filters.severity === "5plus") violationsQuery = violationsQuery.gte("severity_weight", 5);
    if (filters.severity === "under5") violationsQuery = violationsQuery.lt("severity_weight", 5);
    if (filters.severity === "unscored") violationsQuery = violationsQuery.is("severity_weight", null);
    if (filters.from) violationsQuery = violationsQuery.gte("inspections.inspection_date", filters.from);
    if (filters.to) violationsQuery = violationsQuery.lte("inspections.inspection_date", filters.to);
    return violationsQuery.in("inspection_id", inspectionIds);
  });

  const [
    { data: client, error: clientError },
    { data: violations, error: violationsError },
    { data: cpdpCases },
    { data: dataqCases },
    burden,
  ] = await Promise.all([
    supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single(),
    scopedViolationsQuery,
    supabase
      .from("cpdp_cases")
      .select("id, case_number, status")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("dataq_cases")
      .select("id, case_number, status, violation_id")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    getClientBurden(id),
  ]);

  if (clientError && clientError.code !== "PGRST116") throw new Error(`Unable to load violations client: ${clientError.message}`);
  if (!client) notFound();
  if (violationsError) throw new Error(`Unable to filter violations: ${violationsError.message}`);
  const now = new Date();
  const scored = ((violations ?? []) as ViolationRow[]).map(row => ({ row, tier: scoreChallenge({ violationCode: row.violation_code ?? "", basicCategory: row.basic_category, severityWeight: row.severity_weight, timeWeight: timeWeightFor(row.inspections?.inspection_date ?? null, now), challengeReason: row.challenge_reason, oosViolation: row.oos_violation, convicted: row.convicted, citationNumber: row.citation_number, citationResult: row.citation_result, challengeTier: row.challenge_tier, basicPercentile: null }).label }));
  const tierCounts = countViolationTiers(scored.map(row => row.tier));
  const matchingRows = scored.filter(row => filters.tier === "all" || row.tier === filters.tier).map(row => row.row);

  const openCases = [
    ...((cpdpCases ?? []) as Array<{ id: string; case_number: string | null; status: string | null }>)
      .filter((row) => isOpenCase("CPDP", row.status))
      .map((row) => ({ kind: "CPDP" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
    ...((dataqCases ?? []) as Array<{ id: string; case_number: string | null; status: string | null; violation_id: string | null }>)
      .filter((row) => isOpenCase("DataQ", row.status))
      .map((row) => ({ kind: "DataQ" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl text-navy">Violations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {matchingRows.length} matching violations{" \u00B7 "}{burden.totalPoints} in-window weighted burden{" \u00B7 "}{openCases.length} open case{openCases.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            FMCSA does not publish percentile rankings for low-volume carriers; this is the weighted violation burden that drives the BASIC measures.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Violations matching source filters</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{violations?.length ?? 0}</p>
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">In-window weighted burden</p>
          <p className="text-2xl font-bold text-[#C67A1E] mt-1">{burden.totalPoints}</p>
        </div>
        {burden.perBasic.slice(0, 2).map((b) => (
          <div key={b.basicCategory} className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
            <p className="text-xs text-gray-500">{BASIC_LABELS[b.basicCategory] ?? b.label}</p>
            <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{b.weightedPoints}</p>
            <p className="text-xs text-gray-500 mt-0.5">{b.violationCount} violation{b.violationCount === 1 ? "" : "s"}</p>
          </div>
        ))}
      </div>

      {openCases.length > 0 && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs font-semibold text-[#1E1C1A] mb-2">Open challenge work</p>
          <div className="flex flex-wrap gap-2">
            {openCases.map((item) => (
              <Badge key={`${item.kind}-${item.label}`} variant="warning">
                {item.kind} {item.label}{" \u00B7 "}{item.status}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ViolationAnalyzer
        key={JSON.stringify(filters)}
        clientId={id}
        initialFilters={filters}
        sourceTierCounts={tierCounts}
        violations={matchingRows}
        dataqCases={(dataqCases ?? []) as Array<{ id: string; violation_id: string | null; status: string | null }>}
      />
    </div>
  );
}
