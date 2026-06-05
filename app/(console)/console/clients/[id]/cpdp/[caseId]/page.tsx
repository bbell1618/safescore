import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  CpdpCaseEditor,
  type CpdpCaseRow,
  type CrashRow,
  type EvidenceItem,
} from "@/components/console/cpdp-case-editor";

export const dynamic = "force-dynamic";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export default async function CpdpCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string; caseId: string }>;
}) {
  const { id, caseId } = await params;
  const supabase = getAdmin();

  // Fetch client
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!client) notFound();

  // Fetch CPDP case with crash data
  const { data: cpdpCase } = await supabase
    .from("cpdp_cases")
    .select(
      `id, status, ai_narrative, final_narrative, filing_notes, case_number,
       outcome, determination_date, filed_date,
       cpdp_eligible_types, filed_without_evidence, override_reason,
       narrative_evidence_verified,
       ai_assessed_at, ai_eligibility_verdict, ai_eligibility_rationale, ai_suggested_types,
       crashes(
         id, crash_date, city, state, report_number,
         tow_away, fatalities, injuries, hazmat_release, cpdp_eligible
       )`
    )
    .eq("id", caseId)
    .eq("client_id", id)
    .single();

  if (!cpdpCase) notFound();

  const crashRaw = cpdpCase.crashes as unknown;
  const crash = (Array.isArray(crashRaw) ? crashRaw[0] : crashRaw) as CrashRow | null;

  if (!crash) notFound();

  // Fetch evidence
  const { data: evidenceRows } = await supabase
    .from("cpdp_evidence")
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, storage_path, uploaded_by"
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });

  const evidence: EvidenceItem[] = (evidenceRows ?? []).map((e) => ({
    id: e.id as string,
    doc_type: e.doc_type as string,
    label: e.label as string,
    context_note: e.context_note as string | null,
    fmcsa_category: e.fmcsa_category as string | null,
    required: e.required as boolean,
    status: e.status as string,
    storage_path: e.storage_path as string | null,
    uploaded_by: e.uploaded_by as string | null,
  }));

  const caseRow: CpdpCaseRow = {
    id: cpdpCase.id as string,
    status: cpdpCase.status as string,
    ai_narrative: cpdpCase.ai_narrative as string | null,
    final_narrative: cpdpCase.final_narrative as string | null,
    filing_notes: cpdpCase.filing_notes as string | null,
    case_number: cpdpCase.case_number as string | null,
    outcome: cpdpCase.outcome as string | null,
    determination_date: cpdpCase.determination_date as string | null,
    filed_date: cpdpCase.filed_date as string | null,
    cpdp_eligible_types: cpdpCase.cpdp_eligible_types as string[] | null,
    filed_without_evidence: (cpdpCase.filed_without_evidence as boolean) ?? false,
    override_reason: cpdpCase.override_reason as string | null,
    narrative_evidence_verified: (cpdpCase.narrative_evidence_verified as boolean) ?? false,
    ai_assessed_at: cpdpCase.ai_assessed_at as string | null,
    ai_eligibility_verdict: cpdpCase.ai_eligibility_verdict as string | null,
    ai_eligibility_rationale: cpdpCase.ai_eligibility_rationale as string | null,
    ai_suggested_types: cpdpCase.ai_suggested_types as string[] | null,
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
        <Link href="/console" className="hover:text-[#C67A1E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#C67A1E]">
          {client.name}
        </Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}/cpdp`} className="hover:text-[#C67A1E]">
          CPDP workbench
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">
          {crash.city}, {crash.state} — {crash.crash_date}
        </span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#1E1C1A]">CPDP submission</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Crash Preventability Determination Program — {client.name}
        </p>
      </div>

      <CpdpCaseEditor
        clientId={id}
        cpdpCase={caseRow}
        crash={crash}
        initialEvidence={evidence}
      />
    </div>
  );
}
