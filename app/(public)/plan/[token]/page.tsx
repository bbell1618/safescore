import type { Metadata } from "next";
import { loadPlanPage, planRequestGroups, recordPlanView } from "@/lib/autopilot/plan-page-server";
import { PlanActions } from "./plan-actions";
import { syncPlanCheckout } from "@/lib/autopilot/plan-checkout";
import { getTermsApproval } from "@/lib/legal/approval-server";
import { fmcsaDot } from "@/lib/fmcsa/practice";
import { tierDisplayLabel } from "@/lib/tiers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Your safety plan | Golden Era SafeScore",
  description: "Your DOT safety plan from Golden Era Insurance Agency.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  const started = query.started === "1";
  const sessionId = typeof query.session_id === "string" ? query.session_id : null;
  let data = await loadPlanPage(token);
  // Coming back from a paid Stripe checkout: activate right away.
  const activation = data && started && sessionId && data.client.status !== "active"
    ? await syncPlanCheckout(data.client.id, sessionId)
    : null;
  if (activation?.status === "activated") data = await loadPlanPage(token);
  if (!data) {
    return (
      <main className="portal-brand-root portal-warm-texture flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-sand bg-warm-white p-8 text-center shadow-sm">
          <h1 className="font-heading text-2xl text-navy">This link does not work</h1>
          <p className="mt-2 text-sm text-warm-mid">Reply to our email and we will send you a new one.</p>
        </div>
      </main>
    );
  }
  await recordPlanView(data.client.id).catch(() => undefined);
  const { client, plan } = data;
  // Practice copies can always sign. Real carriers wait for the owner's approval of the terms.
  const termsReady = Boolean(client.is_practice) || Boolean(await getTermsApproval().catch(() => null));

  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark">
      <header className="portal-navy-texture border-b border-gold/20 text-warm-white shadow-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold/35 bg-warm-white/5 font-heading text-sm font-bold text-gold-light">SS</span>
          <div className="min-w-0">
            <p className="font-heading text-base font-semibold">Golden Era SafeScore</p>
            <p className="truncate text-xs text-warm-white/70">Safety plan for {client.name} · DOT {fmcsaDot(client.dot_number)}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {client.is_practice && (
          <p role="note" className="rounded-2xl border-2 border-dashed border-amber bg-amber-subtle px-5 py-3 text-sm text-navy">
            <strong>Practice copy.</strong> This page uses the real carrier&apos;s public FMCSA record, but nothing you do here touches their real file. Payments use Stripe test mode.
          </p>
        )}
        {client.status === "active" ? (
          <p role="status" className="rounded-2xl border border-success/40 bg-success-light px-5 py-4 text-base text-success">
            {started ? "Thank you. Your payment went through. " : ""}Your SafeScore {tierDisplayLabel(client.tier)} service is active. We check your record every day and send you a short update every week.
          </p>
        ) : started && activation && activation.status !== "activated" ? (
          <p role="status" className="rounded-2xl border border-amber/40 bg-amber-subtle px-5 py-4 text-base text-navy">
            Thank you. We are confirming your payment. This page will show your service as active within a few minutes.
            {activation.status === "error" ? <span className="mt-1 block text-xs text-warm-mid">Detail for our team: {activation.message}</span> : null}
          </p>
        ) : null}
        {!plan ? (
          <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
            <h1 className="font-heading text-2xl text-navy">Your plan is being prepared</h1>
            <p className="mt-2 text-sm text-warm-mid">We will email you when it is ready.</p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
              <p className="font-mono text-xs uppercase tracking-widest text-amber-dark">Your safety plan · {formatDate(data.asOf)}</p>
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
          </>
        )}

        <PlanActions
          token={token}
          client={{
            name: client.name,
            status: client.status,
            tier: client.tier,
            signedBy: client.filing_authorized && client.service_agreement_accepted ? client.filing_authorized_by : null,
            signedAt: client.filing_authorized_at,
            eldProvider: client.eld_provider,
            primaryContact: client.primary_contact,
            phone: client.phone,
            driverCount: client.driver_count,
          }}
          groups={planRequestGroups(data.requests, new Map(data.requests.map((r) => [r.id, r.category ?? null])))}
          rosterUrl={data.rosterUrl}
          rosterDriverCount={data.rosterDriverCount}
          eldConnected={data.eldConnected}
          termsReady={termsReady}
        />

        <p className="px-1 pb-8 text-center text-xs leading-5 text-warm-gray">
          Golden Era Insurance Agency · 200 Brown Rd, Suite 203, Fremont, CA 94539 · Questions? Reply to our email.
        </p>
      </div>
    </main>
  );
}
