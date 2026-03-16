import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataqWorkbench } from "@/components/console/dataq-workbench";
import { caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

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

  const { data: cases } = await supabase
    .from("dataq_cases")
    .select("*, violations(violation_code, violation_description, basic_category, severity_weight)")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const counts: Record<string, number> = {};
  for (const c of cases ?? []) {
    counts[c.status] = (counts[c.status] ?? 0) + 1;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#DC362E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#DC362E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#222222] font-medium">DataQs workbench</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold text-[#222222]"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            DataQs workbench
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {cases?.length ?? 0} cases ·{" "}
            <span className="text-green-600 font-medium">{counts.approved ?? 0} approved</span>
            {" · "}
            <span className="text-[#DC362E] font-medium">{counts.denied ?? 0} denied</span>
          </p>
        </div>
        <Link
          href={`/console/clients/${id}/violations`}
          className="px-4 py-2 text-xs font-medium border border-[#E5E5E5] rounded-lg hover:border-[#DC362E] hover:text-[#DC362E] transition-colors"
        >
          + Create from violation
        </Link>
      </div>

      {/* Pipeline summary */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[
          { status: "draft", label: "Draft" },
          { status: "filed", label: "Filed" },
          { status: "pending_state", label: "Pending state" },
          { status: "pending_fmcsa", label: "Pending FMCSA" },
          { status: "approved", label: "Approved" },
          { status: "denied", label: "Denied" },
        ].map((s) => (
          <div
            key={s.status}
            className="flex-1 min-w-[100px] bg-white border border-[#E5E5E5] rounded-xl p-3 text-center"
          >
            <p className="text-xl font-bold text-[#222222]" style={{ fontFamily: "var(--font-montserrat)" }}>
              {counts[s.status] ?? 0}
            </p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <DataqWorkbench clientId={id} cases={cases ?? []} />
    </div>
  );
}
