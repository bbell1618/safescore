import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ViolationAnalyzer } from "@/components/console/violation-analyzer";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";

export const dynamic = "force-dynamic";

function isOpenCase(kind: "CPDP" | "DataQ", status: string | null | undefined) {
  if (!status) return false;
  if (kind === "CPDP") return status === "filed" || status === "pending";
  return status === "investigating" || status === "filed" || status === "pending_state" || status === "pending_fmcsa" || status === "reconsidering";
}

export default async function ViolationsPage({
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

  const [
    { data: violations },
    { data: cpdpCases },
    { data: dataqCases },
    burden,
  ] = await Promise.all([
    supabase
      .from("violations")
      .select("*, inspections(inspection_date, state, level, facility_name)")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
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
          <h1 className="text-xl font-bold text-[#1E1C1A]">Violation analyzer</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {violations?.length ?? 0} violations on file {"\u00B7"} {burden.totalPoints} in-window weighted burden {"\u00B7"} {openCases.length} open case{openCases.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            FMCSA does not publish percentile rankings for low-volume carriers; this is the weighted violation burden that drives the BASIC measures.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Total violations on file</p>
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
                {item.kind} {item.label} {"\u00B7"} {item.status}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ViolationAnalyzer
        clientId={id}
        violations={violations ?? []}
        dataqCases={(dataqCases ?? []) as Array<{ id: string; violation_id: string | null; status: string | null }>}
      />
    </div>
  );
}
