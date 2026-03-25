import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ReportGenerator } from "@/components/console/report-generator";
import { DownloadReportButton } from "@/components/console/download-report-button";
import { formatDate } from "@/lib/utils";
import { ChevronRight, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
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

  const { data: reports } = await supabase
    .from("reports")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const typeLabel: Record<string, string> = {
    assessment: "Assessment report",
    monthly: "Monthly report",
    quarterly: "Quarterly report",
    improvement: "Improvement report",
    underwriter: "Underwriter report",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#DC362E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#DC362E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1A1A1A] font-medium">Reports</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-xl font-bold text-[#1A1A1A]"
          >
            Report generator
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-generated reports with human review before sending to client
          </p>
        </div>
        <DownloadReportButton clientId={id} clientName={client.name} />
      </div>

      <ReportGenerator clientId={id} dotNumber={client.dot_number} carrierName={client.name} />

      {/* Report history */}
      {reports && reports.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E5E5E5]">
            <h2
              className="font-semibold text-[#1A1A1A] text-sm"
            >
              Report history
            </h2>
          </div>
          <div className="divide-y divide-[#E5E5E5]">
            {reports.map((r) => (
              <div key={r.id} className="px-5 py-3.5 flex items-center gap-4">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A]">{r.title}</p>
                  <p className="text-xs text-gray-400">{formatDate(r.created_at)}</p>
                </div>
                <div className="flex gap-2">
                  <Badge>{typeLabel[r.type] ?? r.type}</Badge>
                  <Badge variant={r.status === "sent" ? "success" : r.status === "reviewed" ? "info" : "default"}>
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
