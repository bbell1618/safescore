import type { ReportStatus } from "@/lib/supabase/types";

export type DraftReportAction = "save" | "review";

export type DraftReportUpdate = {
  final_content: string;
  status?: "reviewed";
  reviewed_by?: string;
  reviewed_at?: string;
};

export function isDraftReport(status: ReportStatus): status is "draft" {
  return status === "draft";
}

export function buildDraftReportUpdate({
  action,
  finalContent,
  reviewerId,
  reviewedAt,
}: {
  action: DraftReportAction;
  finalContent: string;
  reviewerId: string;
  reviewedAt: string;
}): DraftReportUpdate {
  if (action === "save") {
    return { final_content: finalContent };
  }

  return {
    final_content: finalContent,
    status: "reviewed",
    reviewed_by: reviewerId,
    reviewed_at: reviewedAt,
  };
}
