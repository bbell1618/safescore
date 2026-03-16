import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ViolationAnalyzer } from "@/components/console/violation-analyzer";
import { formatDate } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

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

  const { data: violations } = await supabase
    .from("violations")
    .select("*, inspections(inspection_date, state, level, facility_name)")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const { data: snapshot } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("client_id", id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  const challengeableCount = violations?.filter((v) => v.challengeable === true).length ?? 0;
  const pendingCount = violations?.filter((v) => v.challengeable === null).length ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#DC362E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#DC362E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#222222] font-medium">Violations</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold text-[#222222]"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Violation analyzer
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {violations?.length ?? 0} violations ·{" "}
            <span className="text-green-600 font-medium">{challengeableCount} challengeable</span>
            {pendingCount > 0 && (
              <span className="text-gray-400"> · {pendingCount} pending AI assessment</span>
            )}
          </p>
        </div>
      </div>

      <ViolationAnalyzer
        clientId={id}
        violations={violations ?? []}
        snapshot={snapshot}
      />
    </div>
  );
}
