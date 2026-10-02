import { PortalHeroBand, PortalPageBody, PortalSectionDivider } from "@/components/portal/brand";
import { TERMS_SECTIONS, type TermsApproval } from "@/lib/legal/terms";
import { TERMS_VERSION_LABEL } from "@/lib/legal/terms-text";

function longDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

export function TermsArticle() {
  return (
    <article aria-label="SafeScore Terms of Service" className="font-heading text-warm-dark">
      <ol className="space-y-5">
        {TERMS_SECTIONS.map((term, index) => (
          <li
            key={term.title}
            className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm print:break-inside-avoid print:border-0 print:bg-white print:p-0 print:pb-5 print:shadow-none"
          >
            <h2 className="text-xl font-semibold text-navy print:text-black">
              <span className="mr-2 font-mono text-sm font-semibold text-amber print:text-black">{index + 1}.</span>
              {" "}
              {term.title}
            </h2>
            {term.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex} className="mt-2 text-base leading-7 text-warm-mid print:text-black">
                {paragraphIndex === 0 && <span aria-hidden="true">{"—"} </span>}
                {paragraph}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function TermsView({ approval }: { approval: TermsApproval | null }) {
  const versionLine = approval
    ? `Approved ${longDate(approval.approvedAt)} · Golden Era Insurance Agency`
    : `Draft — ${TERMS_VERSION_LABEL}`;
  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark print:bg-white print:before:hidden">
      <PortalHeroBand eyebrow="Golden Era SafeScore" title="SafeScore Terms of Service" description={versionLine} contentClassName="max-w-4xl" className="print:hidden" />
      <PortalSectionDivider transition="navy-to-warm" className="print:hidden" />
      <PortalPageBody className="print:bg-white print:before:hidden" contentClassName="max-w-4xl print:max-w-none print:px-0 print:py-0">
        <header className="mb-8 hidden border-b border-black pb-5 print:block">
          <h1 className="font-heading text-3xl font-semibold text-black">SafeScore Terms of Service</h1>
          <p className="mt-2 text-sm text-black">{versionLine}</p>
        </header>
        {!approval && (
          <aside aria-label="Draft approval status" className="mb-6 rounded-xl border-2 border-amber bg-warm-white p-5 print:border-black">
            <p className="text-lg font-semibold text-navy">Draft — pending GEIA approval</p>
            <p className="mt-2 text-sm leading-6 text-warm-mid">These terms are not final until Golden Era Insurance Agency approves them. No customer is asked to agree to them before then.</p>
          </aside>
        )}
        <TermsArticle />
      </PortalPageBody>
      <PortalSectionDivider transition="warm-to-navy" className="print:hidden" />
      <footer className="portal-navy-texture text-warm-white print:hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <p className="font-heading font-semibold">Golden Era Insurance Agency</p>
          <p className="font-mono text-xs text-warm-white/70">SafeScore</p>
        </div>
      </footer>
    </main>
  );
}
