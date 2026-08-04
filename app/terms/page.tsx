import {
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SafeScore Terms of Service",
  description: "SafeScore Terms of Service from Golden Era Insurance Agency.",
};

const VERSION_LINE =
  "Version 1.0 \u2014 August 2026 \u00b7 Golden Era Insurance Agency";

const TERMS = [
  {
    title: "What SafeScore is",
    body: 'SafeScore is a safety data and advocacy service provided by Golden Era Insurance Agency ("GEIA"). We analyze your carrier\'s FMCSA safety record, monitor it for changes, and \u2014 on qualifying plans \u2014 prepare and submit data challenges and crash preventability requests on your behalf, and coach your team through a prioritized safety improvement plan.',
  },
  {
    title: "What SafeScore is not",
    body: "SafeScore is not an insurance policy and does not provide, replace, or guarantee insurance coverage. It is not legal advice. Decisions on data challenges and crash preventability rest solely with FMCSA and its reviewers.",
  },
  {
    title: "No outcome guarantees",
    body: "We commit to the quality of our work, not to outcomes we don't control. We do not guarantee that any score, measure, violation, or crash record will change, or that any challenge will be accepted.",
  },
  {
    title: "Your plan and billing",
    body: "Services and pricing are stated on your subscription confirmation. Monthly plans bill in advance each month. Total Safety pricing includes a per-driver component based on the driver count you provide and keep current. You can cancel any time; cancellation stops future billing at the end of the current period.",
  },
  {
    title: "Authorizations you grant",
    body: "Depending on your plan and the boxes you check during setup, you authorize GEIA to: access your carrier's FMCSA safety data; and prepare and submit DataQ Requests for Data Review and Crash Preventability Determination Program requests to FMCSA on your carrier's behalf. FMCSA notifies a carrier's officials of requests filed on its USDOT number. You can revoke authorizations by written notice; revocation may limit the services we can deliver.",
  },
  {
    title: "Your responsibilities",
    body: "Provide accurate information (including your current driver count), respond to evidence requests in a timely way, and keep your contact details current. Our work product is only as good as the information you give us.",
  },
  {
    title: "Data handling",
    body: "We collect your FMCSA safety data and the information you provide in order to deliver the service. We do not sell your data. Documents you upload are used for the challenges and services you've authorized.",
  },
  {
    title: "Service changes",
    body: "We improve SafeScore continuously and may modify features. If we materially reduce what your plan includes, we'll notify you before your next billing cycle.",
  },
  {
    title: "Liability",
    body: "To the maximum extent permitted by law, GEIA's total liability arising from SafeScore is limited to the amounts you paid for the service in the three months preceding the claim.",
  },
  {
    title: "Terms updates",
    body: "We may update these terms; the current version always lives at this page with its version date. Continued use after an update constitutes acceptance.",
  },
  {
    title: "Contact",
    body: "Golden Era Insurance Agency, 200 Brown Rd Suite 203, Fremont, CA 94539 \u00b7 info@goldenerainsurance.com.",
  },
] as const;

export default function TermsPage() {
  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark print:bg-white print:before:hidden">
      <PortalHeroBand
        eyebrow="Golden Era SafeScore"
        title="SafeScore Terms of Service"
        description={VERSION_LINE}
        contentClassName="max-w-4xl"
        className="print:hidden"
      />
      <PortalSectionDivider
        transition="navy-to-warm"
        className="print:hidden"
      />
      <PortalPageBody
        className="print:bg-white print:before:hidden"
        contentClassName="max-w-4xl print:max-w-none print:px-0 print:py-0"
      >
        <header className="mb-8 hidden border-b border-black pb-5 print:block">
          <h1 className="font-heading text-3xl font-semibold text-black">
            SafeScore Terms of Service
          </h1>
          <p className="mt-2 text-sm text-black">{VERSION_LINE}</p>
        </header>

        <article
          aria-label="SafeScore Terms of Service"
          className="font-heading text-warm-dark"
        >
          <ol className="space-y-5">
            {TERMS.map((term, index) => (
              <li
                key={term.title}
                className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm print:break-inside-avoid print:border-0 print:bg-white print:p-0 print:pb-5 print:shadow-none"
              >
                <h2 className="text-xl font-semibold text-navy print:text-black">
                  <span className="mr-2 font-mono text-sm font-semibold text-amber print:text-black">
                    {index + 1}.
                  </span>
                  {" "}
                  {term.title}
                </h2>
                <p className="mt-2 text-base leading-7 text-warm-mid print:text-black">
                  <span aria-hidden="true">{"\u2014"} </span>
                  {term.body}
                </p>
              </li>
            ))}
          </ol>
        </article>
      </PortalPageBody>
      <PortalSectionDivider
        transition="warm-to-navy"
        className="print:hidden"
      />
      <footer className="portal-navy-texture text-warm-white print:hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <p className="font-heading font-semibold">Golden Era Insurance Agency</p>
          <p className="font-mono text-xs text-warm-white/70">SafeScore</p>
        </div>
      </footer>
    </main>
  );
}
