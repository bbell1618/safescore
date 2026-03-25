import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const supabase = await createClient();

  const { data: logsRaw } = await supabase
    .from("activity_log")
    .select("*, clients(name), users(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const logs = logsRaw as Array<{
    id: string;
    action_type: string;
    description: string;
    created_at: string;
    clients: { name: string } | null;
    users: { full_name: string; email: string } | null;
  }> | null;

  const typeColorMap: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
    case_created: "info",
    case_filed: "success",
    case_approved: "success",
    case_denied: "danger",
    analysis_run: "info",
    client_added: "success",
    report_generated: "info",
    report_sent: "success",
    violation_assessed: "default",
    credential_accessed: "warning",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-5 h-5 text-gray-400" />
        <div>
          <h1
            className="text-xl font-bold text-[#1A1A1A]"
           
          >
            Activity log
          </h1>
          <p className="text-sm text-gray-500">Full audit trail — all actions across all clients</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        {logs && logs.length > 0 ? (
          <div className="divide-y divide-[#E5E5E5]">
            {logs.map((log) => (
              <div key={log.id} className="px-5 py-3.5 flex items-start gap-4">
                <div className="shrink-0 pt-0.5">
                  <Badge variant={typeColorMap[log.action_type] ?? "default"}>
                    {log.action_type.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1A1A1A]">{log.description}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                    {(log.clients as { name: string } | null)?.name && (
                      <span>{(log.clients as { name: string }).name}</span>
                    )}
                    {(log.users as { full_name: string; email: string } | null) && (
                      <span>
                        by {(log.users as { full_name: string; email: string }).full_name || (log.users as { full_name: string; email: string }).email}
                      </span>
                    )}
                    <span>{formatDate(log.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <Activity className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No activity yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Actions will appear here as staff use the console.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
