import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { ReportViewer } from "./report-viewer";

export const dynamic = "force-dynamic";

export default async function PortalReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#F4F4F4] flex items-center justify-center">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm text-gray-500">Your account is being set up.</p>
      </div>
    );
  }

  const clientId = userRecord.client_id;

  const { data: reports } = await supabase
    .from("reports")
    .select("id, type, title, final_content, sent_at")
    .eq("client_id", clientId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1
          className="text-xl font-bold text-[#222222]"
          style={{ fontFamily: "var(--font-montserrat)" }}
        >
          Reports
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Assessment and safety reports GEIA has sent to your company.
        </p>
      </div>

      {reports && reports.length > 0 ? (
        <ReportViewer reports={reports} />
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-12 text-center">
          <p className="text-sm text-gray-500">No reports have been sent yet.</p>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            GEIA will send your first assessment report after completing your initial analysis.
          </p>
        </div>
      )}
    </div>
  );
}
