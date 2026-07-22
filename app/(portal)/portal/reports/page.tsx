import { getPortalPageAccess } from "@/lib/portal/access";
import { ReportViewer } from "./report-viewer";
import { PortalDownloadReportButton } from "@/components/portal/download-report-button";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";

export const dynamic = "force-dynamic";

export default async function PortalReportsPage() {
  const access = await getPortalPageAccess("monthly_reports");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        feature="monthly_reports"
        currentTier={access.tier}
        title="Monthly reports are not included in your plan"
      />
    );
  }
  const { clientId, supabase } = access;

  const { data: reports } = await supabase
    .from("reports")
    .select("id, type, title, final_content, sent_at")
    .eq("client_id", clientId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-xl font-bold text-[#1E1C1A]"
          >
            Reports
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Assessment and safety reports GEIA has sent to your company.
          </p>
        </div>
        <PortalDownloadReportButton />
      </div>

      {reports && reports.length > 0 ? (
        <ReportViewer reports={reports} />
      ) : (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] px-5 py-12 text-center">
          <p className="text-sm text-gray-500">No reports have been sent yet.</p>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            GEIA will send your first assessment report after completing your initial analysis.
          </p>
        </div>
      )}
    </div>
  );
}
