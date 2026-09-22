import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ReportGenerator } from "@/components/console/report-generator";
import { DownloadReportButton } from "@/components/console/download-report-button";
import { formatDate } from "@/lib/utils";
import { ChevronRight, FileText } from "lucide-react";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { normalizeClientTier } from "@/lib/tiers";


export default async function ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client, error: clientError }, { data: reports, error: reportsError }] = await Promise.all([supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single(), supabase
    .from("reports")
    .select("id, type, title, status, created_at")
    .eq("client_id", id)
    .order("created_at", { ascending: false })]);
  if (clientError && clientError.code !== "PGRST116") throw new Error(`Unable to load reports client: ${clientError.message}`);
  if (!client) notFound();
  if (reportsError) throw new Error(`Unable to load report history: ${reportsError.message}`);
  const clientTier = normalizeClientTier(client.tier);

  const typeLabel: Record<string, string> = {
    assessment: "Assessment report",
    monthly: "Monthly report",
    quarterly: "Quarterly report",
    improvement: "Improvement report",
    underwriter: "Underwriter report",
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl text-navy">Reports</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Generate a draft, review it, then use the existing delivery workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ServiceTierChip tier={clientTier} feature="monthly_reports" />
          <DownloadReportButton clientId={id} clientName={client.name} />
        </div>
      </div>

      <ReportGenerator clientId={id} clientTier={clientTier} />

      {(!reports || reports.length === 0) && <div className="rounded-xl border border-sand bg-warm-white p-6"><h3 className="font-heading text-xl text-navy">No reports yet</h3><p className="mt-2 text-sm text-warm-mid">Generated drafts and reviewed reports will appear here.</p></div>}
      {/* Report history */}
      {reports && reports.length > 0 && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA]">
            <h2
              className="font-semibold text-[#1E1C1A] text-sm"
            >
              Report history
            </h2>
          </div>
          <div className="divide-y divide-[#F0E8DA]">
            {reports.map((r) => (
              <Link
                key={r.id}
                href={`/console/clients/${id}/reports/${r.id}`}
                className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C67A1E]"
                aria-label={`Open ${r.title}`}
              >
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1E1C1A]">{r.title}</p>
                  <p className="font-mono text-xs text-warm-gray">{formatDate(r.created_at)}</p>
                </div>
                <div className="flex gap-2">
                  <Badge>{typeLabel[r.type] ?? r.type}</Badge>
                  <Badge variant={r.status === "sent" ? "success" : r.status === "reviewed" ? "info" : "warning"} className={r.status === "sent" ? "bg-success-light text-success" : r.status === "reviewed" ? "bg-info-light text-info" : "bg-amber-subtle text-amber-dark"}>
                    {r.status}
                  </Badge>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
