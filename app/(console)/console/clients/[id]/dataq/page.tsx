import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DataqWorkbench } from "@/components/console/dataq-workbench";
import { ChevronRight } from "lucide-react";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { normalizeClientTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function DataqPage({
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
  const clientTier = normalizeClientTier(client.tier);

  const { data: cases } = await supabase
    .from("dataq_cases")
    .select(
      `*,
      canonical_inspection_date,
      dataqs_reason_code,
      filed_without_evidence,
      override_reason,
      narrative_evidence_verified,
      violations(
        violation_code,
        violation_description,
        basic_category,
        severity_weight,
        oos_violation,
        citation_number,
        citation_result,
        challenge_reason,
        challenge_priority,
        inspection_id
      ),
      inspections(
        inspection_date,
        state,
        level,
        facility_name,
        report_number
      )`
    )
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  // Fetch evidence for all cases server-side
  const caseIds = (cases ?? []).map((c) => c.id);
  const { data: evidenceRows } = caseIds.length
    ? await supabase
        .from("dataq_evidence")
        .select(
          "id, case_id, doc_type, label, context_note, fmcsa_category, required, status, storage_path, uploaded_by, acquisition_method, auto_source, needed_reason"
        )
        .in("case_id", caseIds)
    : { data: [] };

  // Build evidenceMap: Record<caseId, EvidenceItem[]>
  const evidenceMap: Record<string, Array<{
    id: string;
    doc_type: string;
    label: string;
    context_note: string | null;
    fmcsa_category: string | null;
    required: boolean;
    status: string;
    storage_path: string | null;
    uploaded_by: string | null;
    acquisition_method: string | null;
    auto_source: string | null;
    needed_reason: string | null;
  }>> = {};
  for (const row of evidenceRows ?? []) {
    const cid = row.case_id as string;
    if (!evidenceMap[cid]) evidenceMap[cid] = [];
    evidenceMap[cid].push({
      id: row.id as string,
      doc_type: row.doc_type as string,
      label: row.label as string,
      context_note: row.context_note as string | null,
      fmcsa_category: row.fmcsa_category as string | null,
      required: row.required as boolean,
      status: row.status as string,
      storage_path: row.storage_path as string | null,
      uploaded_by: row.uploaded_by as string | null,
      acquisition_method: row.acquisition_method as string | null,
      auto_source: row.auto_source as string | null,
      needed_reason: row.needed_reason as string | null,
    });
  }

  const counts: Record<string, number> = {};
  for (const c of cases ?? []) {
    counts[c.status] = (counts[c.status] ?? 0) + 1;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#C67A1E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#C67A1E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">DataQs workbench</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1E1C1A]">
            DataQs workbench
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {cases?.length ?? 0} cases {"\u00B7"}{" "}
            <span className="text-green-600 font-medium">{counts.approved ?? 0} approved</span>
            {" "}{"\u00B7"}{" "}
            <span className="text-[#C67A1E] font-medium">{counts.denied ?? 0} denied</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ServiceTierChip tier={clientTier} feature="case_visibility" />
          <Link
            href={`/console/clients/${id}/violations`}
            className="px-4 py-2 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
          >
            + Create from violation
          </Link>
        </div>
      </div>

      {/* Pipeline summary */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[
          { status: "investigating", label: "Investigating" },
          { status: "draft", label: "Draft" },
          { status: "filed", label: "Filed" },
          { status: "pending_state", label: "Pending state" },
          { status: "pending_fmcsa", label: "Pending FMCSA" },
          { status: "approved", label: "Approved" },
          { status: "denied", label: "Denied" },
        ].map((s) => (
          <div
            key={s.status}
            className="flex-1 min-w-[100px] bg-[#FBF7F0] border border-[#F0E8DA] rounded-xl p-3 text-center"
          >
            <p className="text-xl font-bold text-[#1E1C1A]">
              {counts[s.status] ?? 0}
            </p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <DataqWorkbench
        clientId={id}
        clientTier={clientTier}
        filingAuthorized={(client.filing_authorized as boolean | null) ?? false}
        filingAuthorizedBy={client.filing_authorized_by as string | null}
        filingAuthorizationScope={client.filing_authorization_scope as string | null}
        cases={cases ?? []}
        evidenceMap={evidenceMap}
      />
    </div>
  );
}
