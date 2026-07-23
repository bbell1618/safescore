import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintReportButton } from "@/components/reports/print-report-button";
import { ReportContent } from "@/components/reports/report-content";
import {
  loadStaffReportDetail,
  ReportAccessError,
} from "@/lib/reports/report-access-server";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

async function printableReport(clientId: string, reportId: string) {
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

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id, reportId } = await params;
  const detail = await printableReport(id, reportId);
  const content =
    detail.report.final_content ?? detail.report.ai_content ?? "";

  return (
    <main className="min-h-screen bg-[#F1ECE4] px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-4 print:hidden">
        <Link
          href={`/console/clients/${id}/reports/${reportId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-[#9A5A14]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to report
        </Link>
        <PrintReportButton />
      </div>

      <article className="mx-auto min-h-[11in] max-w-[8.5in] bg-white px-[0.7in] py-[0.65in] shadow-sm print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-[#1B2D4F] pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9A5A14]">
              Golden Era SafeScore
            </p>
            <p className="mt-2 text-sm font-medium text-[#1E1C1A]">
              {detail.client.name}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              USDOT {detail.client.dot_number}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500">
              {detail.report.status === "draft"
                ? "Draft — not client-ready"
                : detail.report.status}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Created {formatDate(detail.report.created_at)}
            </p>
          </div>
        </header>

        <ReportContent content={content} />

        <footer className="mt-12 border-t border-[#D8CCBA] pt-4 text-[10px] leading-5 text-gray-500">
          <p>Golden Era Insurance Agency · SafeScore</p>
          <p>
            Printed {formatDate(new Date().toISOString())} · Report ID{" "}
            {detail.report.id}
          </p>
        </footer>
      </article>
    </main>
  );
}
