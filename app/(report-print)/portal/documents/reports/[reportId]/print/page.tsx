import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { SentReportContent } from "@/components/portal/sent-report-content";
import { SentReportPrintButton } from "@/components/portal/sent-report-print-button";
import { getPortalPageAccess } from "@/lib/portal/access";

export const dynamic = "force-dynamic";

const reportIdSchema = z.string().uuid();

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function SentReportPrintPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  if (!reportIdSchema.safeParse(reportId).success) notFound();

  const access = await getPortalPageAccess("monthly_reports");
  if (!access.allowed) redirect("/portal/documents#from-geia");

  const { data: report, error } = await access.supabase
    .from("reports")
    .select("id, client_id, type, title, status, final_content, sent_at")
    .eq("id", reportId)
    .eq("client_id", access.clientId)
    .eq("status", "sent")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the sent report: ${error.message}`);
  }
  if (!report) notFound();

  return (
    <main className="min-h-screen bg-cream px-4 py-6 print:bg-warm-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-4 print:hidden">
        <Link
          href="/portal/documents#from-geia"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-warm-mid transition-colors duration-150 hover:text-amber-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Documents
        </Link>
        <SentReportPrintButton />
      </div>

      <article className="mx-auto min-h-screen max-w-4xl bg-warm-white p-10 shadow-sm sm:p-12 print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-navy pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-dark">
              Golden Era SafeScore
            </p>
            <p className="mt-2 text-sm font-semibold text-warm-dark">
              {access.clientName}
            </p>
            <p className="mt-0.5 text-xs text-warm-mid">
              USDOT {access.dotNumber}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-success">
              Sent report
            </p>
            <p className="mt-2 text-xs text-warm-mid">
              {report.sent_at
                ? `Sent ${formatDate(report.sent_at)}`
                : "Sent date not recorded"}
            </p>
          </div>
        </header>

        <SentReportContent content={report.final_content ?? ""} />

        <footer className="mt-12 border-t border-sand pt-4 text-xs leading-5 text-warm-gray">
          <p>Golden Era Insurance Agency · SafeScore</p>
          <p>
            Printed {formatDate(new Date().toISOString())} · Report ID{" "}
            {report.id}
          </p>
        </footer>
      </article>
    </main>
  );
}
