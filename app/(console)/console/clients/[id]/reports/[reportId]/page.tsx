import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReportDetailActions } from "@/components/console/report-detail-actions";
import { Badge } from "@/components/ui/badge";
import {
  loadStaffReportDetail,
  ReportAccessError,
} from "@/lib/reports/report-access-server";
import type { ReportStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const reportTypeLabels: Record<string, string> = {
  assessment: "Assessment report",
  monthly: "Monthly report",
  quarterly: "Quarterly report",
  improvement: "Improvement report",
  underwriter: "Underwriter report",
};

const statusLabels: Record<ReportStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  sent: "Sent",
};

const statusVariants: Record<
  ReportStatus,
  "default" | "info" | "success"
> = {
  draft: "default",
  reviewed: "info",
  sent: "success",
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

async function reportDetail(clientId: string, reportId: string) {
  try {
    return await loadStaffReportDetail({ clientId, reportId });
  } catch (error) {
    if (error instanceof ReportAccessError) {
      if (error.status === 401) redirect("/login");
      if (error.status === 403) redirect("/portal");
      if (error.status === 404) notFound();
    }
    throw error;
  }
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id, reportId } = await params;
  const detail = await reportDetail(id, reportId);
  const reviewerLabel = detail.reviewer
    ? detail.reviewer.full_name || detail.reviewer.email
    : null;
  const printHref = `/console/clients/${id}/reports/${reportId}/print`;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <Link
        href={`/console/clients/${id}/reports`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-[#9A5A14]"
      >
        <ArrowLeft className="h-4 w-4" />
        Report history
      </Link>

      <header className="rounded-xl border border-[#E7DDCE] bg-[#FBF7F0] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500">
              {reportTypeLabels[detail.report.type] ?? detail.report.type}
            </p>
            <h1 className="mt-1 font-serif text-2xl font-bold text-[#1E1C1A]">
              {detail.report.title}
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {detail.client.name} · USDOT {detail.client.dot_number}
            </p>
          </div>
          <Badge variant={statusVariants[detail.report.status]}>
            {statusLabels[detail.report.status]}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-3 border-t border-[#E7DDCE] pt-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-gray-400">Created</dt>
            <dd className="mt-1 font-medium text-[#4D463E]">
              {formatTimestamp(detail.report.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Review</dt>
            <dd className="mt-1 font-medium text-[#4D463E]">
              {detail.report.reviewed_at
                ? `${formatTimestamp(detail.report.reviewed_at)}${reviewerLabel ? ` by ${reviewerLabel}` : ""}`
                : detail.report.status === "reviewed" ||
                    detail.report.status === "sent"
                  ? "Reviewed before audit tracking"
                  : "Not reviewed"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Delivery</dt>
            <dd className="mt-1 font-medium text-[#4D463E]">
              {detail.report.sent_at
                ? `Sent ${formatTimestamp(detail.report.sent_at)}`
                : "Not sent"}
            </dd>
          </div>
        </dl>
      </header>

      <ReportDetailActions
        clientId={id}
        reportId={reportId}
        reportTitle={detail.report.title}
        initialStatus={detail.report.status}
        initialFinalContent={detail.report.final_content}
        aiContent={detail.report.ai_content}
        printHref={printHref}
      />
    </div>
  );
}
