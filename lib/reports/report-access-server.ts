import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ReportStatus, ReportType } from "@/lib/supabase/types";

export class ReportAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404 | 500
  ) {
    super(message);
    this.name = "ReportAccessError";
  }
}

export type StaffReportRecord = {
  id: string;
  client_id: string;
  type: ReportType;
  title: string;
  status: ReportStatus;
  ai_content: string | null;
  final_content: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  created_by: string | null;
};

export type StaffReportContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string };
  report: StaffReportRecord;
};

const REPORT_DETAIL_COLUMNS =
  "id, client_id, type, title, status, ai_content, final_content, reviewed_at, reviewed_by, sent_at, sent_by, created_at, created_by";

export async function requireStaffReportContext({
  clientId,
  reportId,
}: {
  clientId: string;
  reportId: string;
}): Promise<StaffReportContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new ReportAccessError("Authentication required", 401);
  }

  const { data: staff, error: staffError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staffError) {
    throw new ReportAccessError(
      `Unable to verify report access: ${staffError.message}`,
      500
    );
  }
  if (
    !staff ||
    (staff.role !== "geia_admin" && staff.role !== "geia_staff")
  ) {
    throw new ReportAccessError("Staff access required", 403);
  }

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select(REPORT_DETAIL_COLUMNS)
    .eq("id", reportId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (reportError) {
    throw new ReportAccessError(
      `Unable to load report: ${reportError.message}`,
      500
    );
  }
  if (!report) {
    throw new ReportAccessError("Report not found for this client", 404);
  }

  return {
    supabase,
    user: { id: user.id, email: user.email },
    report: report as StaffReportRecord,
  };
}
export async function loadStaffReportDetail(params: {
  clientId: string;
  reportId: string;
}) {
  const context = await requireStaffReportContext(params);
  const clientQuery = context.supabase
    .from("clients")
    .select("id, name, dot_number")
    .eq("id", params.clientId)
    .maybeSingle();
  const reviewerQuery = context.report.reviewed_by
    ? context.supabase
        .from("users")
        .select("id, full_name, email")
        .eq("id", context.report.reviewed_by)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [clientResult, reviewerResult] = await Promise.all([
    clientQuery,
    reviewerQuery,
  ]);
  if (clientResult.error) {
    throw new ReportAccessError(
      `Unable to load report client: ${clientResult.error.message}`,
      500
    );
  }
  if (!clientResult.data) {
    throw new ReportAccessError("Report client not found", 404);
  }
  if (reviewerResult.error) {
    throw new ReportAccessError(
      `Unable to load report reviewer: ${reviewerResult.error.message}`,
      500
    );
  }

  return {
    ...context,
    client: clientResult.data,
    reviewer: reviewerResult.data,
  };
}
