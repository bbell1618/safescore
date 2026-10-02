import type { Metadata } from "next";
import { TermsArticle } from "@/components/legal/terms-view";
import { TermsApprovalForm } from "@/components/console/terms-approval-form";
import { getTermsApproval } from "@/lib/legal/approval-server";
import { FILING_AUTHORIZATION_WORDING, SERVICE_AGREEMENT_WORDING } from "@/lib/legal/wording";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Owner approval | SafeScore" };

function longDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

export default async function TermsApprovalPage() {
  const approval = await getTermsApproval();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-amber-dark">Owner approval</p>
        <h1 className="mt-1 font-heading text-3xl text-navy">SafeScore terms and filing authorization</h1>
        <p className="mt-2 text-base leading-7 text-warm-mid">
          This is the wording every SafeScore customer agrees to before we work on their record. It needs the owner&apos;s approval once. If the wording ever changes, it comes back here.
        </p>
      </header>

      {approval ? (
        <p role="status" className="rounded-2xl border border-success/40 bg-success-light px-5 py-4 text-base text-success">
          Approved by {approval.name} on {longDate(approval.approvedAt)}. The draft notice is off and customers can sign.
        </p>
      ) : (
        <p role="status" className="rounded-2xl border-2 border-amber bg-amber-subtle px-5 py-4 text-base text-navy">
          Not approved yet. Customers see these terms marked as a draft and cannot sign.
        </p>
      )}

      <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
        <h2 className="font-heading text-2xl text-navy">1. What the customer checks when they sign</h2>
        <p className="mt-1 text-sm text-warm-mid">Two boxes, then their name and title.</p>
        <blockquote className="mt-4 rounded-lg bg-cream px-4 py-3 text-base leading-7">{SERVICE_AGREEMENT_WORDING}</blockquote>
        <blockquote className="mt-3 rounded-lg bg-cream px-4 py-3 text-base leading-7">{FILING_AUTHORIZATION_WORDING}</blockquote>
      </section>

      <section>
        <h2 className="px-1 font-heading text-2xl text-navy">2. The full terms of service</h2>
        <div className="mt-4"><TermsArticle /></div>
      </section>

      {!approval && (
        <section className="rounded-2xl border-2 border-navy bg-warm-white p-6 shadow-sm">
          <h2 className="font-heading text-2xl text-navy">3. Approve</h2>
          <div className="mt-4"><TermsApprovalForm /></div>
        </section>
      )}
    </div>
  );
}
