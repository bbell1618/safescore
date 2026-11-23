import type { Metadata } from "next";
import Link from "next/link";
import { accountLink } from "@/lib/autopilot/account-invite";
import { clientForPlanToken } from "@/lib/autopilot/plan-page-server";
import { serviceClient } from "@/lib/autopilot/queue";
import { fmcsaDot } from "@/lib/fmcsa/practice";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Golden Era SafeScore",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * QF-221: this link used to show the whole safety plan to anyone who held it. Brandon's ruling
 * (11/23/2026): nothing is given away before the carrier has an account and has paid. The page is
 * now only a door: make your account, or sign in. The plan lives inside the account.
 */
export default async function PlanGatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await clientForPlanToken(token).catch(() => null);
  if (!client) {
    return (
      <main className="portal-brand-root portal-warm-texture flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-sand bg-warm-white p-8 text-center shadow-sm">
          <h1 className="font-heading text-2xl text-navy">This link does not work</h1>
          <p className="mt-2 text-sm text-warm-mid">Reply to our email and we will send you a new one.</p>
        </div>
      </main>
    );
  }
  const link = await accountLink(serviceClient(), client.id, client.email).catch(() => null);
  const path = link ? link.href.replace(/^https?:\/\/[^/]+/, "") : "/login";
  return (
    <main className="portal-brand-root portal-warm-texture flex min-h-screen items-center justify-center p-6 text-warm-dark">
      <div className="w-full max-w-md rounded-2xl border border-sand bg-warm-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-navy font-heading text-sm font-bold text-gold-light">SS</span>
        <p className="mt-4 font-mono text-xs uppercase tracking-widest text-amber-dark">Golden Era SafeScore</p>
        <h1 className="mt-1 font-heading text-2xl text-navy">{client.name}</h1>
        <p className="text-xs text-warm-gray">DOT {fmcsaDot(client.dot_number)}</p>
        <p className="mt-4 text-base leading-7 text-warm-mid">
          {link?.hasAccount
            ? "Your safety plan, your to-do list and your reports are inside your SafeScore account."
            : "Your safety plan opens inside your SafeScore account. Setting it up takes about 5 minutes."}
        </p>
        <Link href={path} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-amber px-5 py-3 text-base font-semibold text-white hover:bg-amber-dark">
          {link?.hasAccount ? "Sign in to your account" : "Set up your account"}
        </Link>
        {!link?.hasAccount ? <p className="mt-3 text-sm text-warm-mid">Already made it? <Link href="/login" className="font-semibold text-amber-dark underline">Sign in</Link></p> : null}
      </div>
    </main>
  );
}
