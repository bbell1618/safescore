import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const draft = readFileSync(join(process.cwd(), "content/legal/terms-draft.md"), "utf8").replaceAll("\r\n", "\n");
const VERSION_LINE = "Draft version — September 2026 · Golden Era Insurance Agency";
const TERMS = draft.split(/^## /m).slice(1).map((section) => {
  const [title, ...body] = section.trim().split("\n");
  return { title, paragraphs: body.join("\n").trim().split(/\n\s*\n/) };
});

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

        <aside aria-label="Draft approval status" className="mb-6 rounded-xl border-2 border-amber bg-warm-white p-5 print:border-black">
          <p className="text-lg font-semibold text-navy">Draft — pending GEIA approval</p>
          <p className="mt-2 text-sm leading-6 text-warm-mid">This draft is for GEIA review. It is not legal advice or final, approved terms for a new customer agreement.</p>
        </aside>
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
                {term.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex} className="mt-2 text-base leading-7 text-warm-mid print:text-black">
                    {paragraphIndex === 0 && <span aria-hidden="true">{"\u2014"} </span>}
                    {paragraph}
                  </p>
                ))}
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
