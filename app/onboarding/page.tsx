import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanActions } from "@/app/(public)/plan/[token]/plan-actions";
import { loadPlanPage } from "@/lib/autopilot/plan-page-server";
import { syncPlanCheckout } from "@/lib/autopilot/plan-checkout";
import { serviceClient } from "@/lib/autopilot/queue";
import { fmcsaDot } from "@/lib/fmcsa/practice";
import { getTermsApproval } from "@/lib/legal/approval-server";
import { getPortalClientPageContext } from "@/lib/portal/access";
import { GeiaHeader } from "@/components/brand/geia-header";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Finish sign-up | Golden Era SafeScore",
  robots: { index: false, follow: false },
};

/**
 * QF-221: sign-up for a carrier who has just made their account.
 *
 * Four short steps (confirm details, choose service, sign, pay). Nothing about their safety plan is
 * shown here: Brandon's ruling (11/23/2026) is that the plan and everything else open after they
 * have signed up and paid. Once paid they are sent to their account home.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getPortalClientPageContext();
  const query = await searchParams;
  const started = query.started === "1";
  const sessionId = typeof query.session_id === "string" ? query.session_id : null;

  const { data: row } = await serviceClient().from("clients").select("plan_token").eq("id", context.clientId).maybeSingle();
  const token = (row?.plan_token as string | undefined) ?? null;
  let data = token ? await loadPlanPage(token) : null;
  if (!data || !token) {
    return (
      <main className="portal-brand-root portal-warm-texture flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-sand bg-warm-white p-8 text-center shadow-sm">
          <h1 className="font-heading text-2xl text-navy">Your account is not ready yet</h1>
          <p className="mt-2 text-sm text-warm-mid">Reply to our email and we will fix it.</p>
        </div>
      </main>
    );
  }

  // Coming back from a paid Stripe checkout: activate right away, then open the account.
  const activation = started && sessionId && data.client.status !== "active" ? await syncPlanCheckout(data.client.id, sessionId) : null;
  if (activation?.status === "activated") data = (await loadPlanPage(token)) ?? data;
  if (data.client.status === "active") redirect("/portal?welcome=1");

  const { client } = data;
  // Practice copies can always sign. Real carriers wait for the owner's approval of the terms.
  const termsReady = Boolean(client.is_practice) || Boolean(await getTermsApproval().catch(() => null));

  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark">
      <GeiaHeader subtitle={`${client.name} · DOT ${fmcsaDot(client.dot_number)}`} />

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {client.is_practice && (
          <p role="note" className="rounded-2xl border-2 border-dashed border-amber bg-amber-subtle px-5 py-3 text-sm text-navy">
            <strong>Practice copy.</strong> Nothing you do here touches the real carrier&apos;s file. Payments use Stripe test mode.
          </p>
        )}
        {started && activation && activation.status !== "activated" ? (
          <p role="status" className="rounded-2xl border border-amber/40 bg-amber-subtle px-5 py-4 text-base text-navy">
            Thank you. We are confirming your payment. Refresh this page in a minute and your account will open.
            {activation.status === "error" ? <span className="mt-1 block text-xs text-warm-mid">Detail for our team: {activation.message}</span> : null}
          </p>
        ) : null}

        <PlanActions
          token={token}
          accountEmail={context.userEmail}
          client={{
            name: client.name,
            status: client.status,
            tier: client.tier,
            signedBy: client.filing_authorized && client.service_agreement_accepted ? client.filing_authorized_by : null,
            signedAt: client.filing_authorized_at,
            eldProvider: client.eld_provider,
            primaryContact: client.primary_contact,
            primaryContactTitle: client.primary_contact_title,
            phone: client.phone,
            email: client.email,
            driverCount: client.driver_count,
            fleetSize: client.fleet_size,
            recommendedTier: client.recommended_tier,
            detailsConfirmedAt: client.details_confirmed_at,
            operatingRadius: client.operating_radius,
            operatingStates: client.operating_states ?? [],
            vehicleTypes: client.vehicle_types ?? [],
            fromClientFile: Boolean(client.geia_client),
          }}
          groups={[]}
          rosterUrl={null}
          rosterDriverCount={data.rosterDriverCount}
          vehicleCount={data.vehicleCount}
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
