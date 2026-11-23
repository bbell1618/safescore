import type { PlanPageData } from "@/lib/autopilot/plan-page-server";

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

/** The carrier's safety plan. QF-221: shown only inside their account, after they have paid. */
export function SafetyPlanContent({ plan, asOf }: { plan: NonNullable<PlanPageData["plan"]>; asOf: string | null }) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-amber-dark">Your safety plan · {formatDate(asOf)}</p>
        <h1 className="mt-2 font-heading text-3xl leading-tight text-navy">{plan.headline}</h1>
      </section>

      <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
        <h2 className="font-heading text-2xl text-navy">Where you stand</h2>
        <ul className="mt-3 space-y-3">
          {plan.standing.map((line) => (
            <li key={line} className="flex gap-3 text-base leading-7"><span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-amber" />{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-warm-gray">From your public FMCSA record. Only inspections and crashes from the last 2 years count.</p>
      </section>

      {plan.fixes.length > 0 && (
        <section className="space-y-4">
          <h2 className="px-1 font-heading text-2xl text-navy">Do these first</h2>
          {plan.fixes.map((fix, i) => (
            <article key={fix.familyKey} className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-heading text-lg text-gold-light">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="font-heading text-xl text-navy">{fix.title}</h3>
                  <p className="mt-1 text-sm text-warm-mid">{fix.why}</p>
                </div>
              </div>
              <ol className="mt-4 space-y-2 pl-12">
                {fix.steps.map((step) => <li key={step} className="list-decimal text-base leading-7">{step}</li>)}
              </ol>
              <p className="mt-4 rounded-lg bg-cream px-4 py-3 text-sm"><span className="font-semibold text-navy">It is working when: </span>{fix.doneWhen}</p>
            </article>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
        <h2 className="font-heading text-2xl text-navy">What we do for you</h2>
        <ul className="mt-3 space-y-2">
          {plan.weDo.map((line) => <li key={line} className="flex gap-3 text-base leading-7"><span aria-hidden className="text-success">✓</span>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}
