import type { Metadata } from "next";
import { SafetyPlanContent } from "@/components/portal/safety-plan-content";
import { loadPlanPage } from "@/lib/autopilot/plan-page-server";
import { serviceClient } from "@/lib/autopilot/queue";
import { getPortalClientPageContext } from "@/lib/portal/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your safety plan | Golden Era SafeScore" };

/** QF-221: the carrier's safety plan, inside their account (it used to be an open link). */
export default async function PortalSafetyPlanPage() {
  const context = await getPortalClientPageContext();
  const { data: row } = await serviceClient().from("clients").select("plan_token").eq("id", context.clientId).maybeSingle();
  const data = row?.plan_token ? await loadPlanPage(row.plan_token as string) : null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      {data?.plan ? <SafetyPlanContent plan={data.plan} asOf={data.asOf} /> : (
        <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
          <h1 className="font-heading text-2xl text-navy">Your plan is being prepared</h1>
          <p className="mt-2 text-sm text-warm-mid">It will show here as soon as it is ready. Nothing is needed from you for this.</p>
        </section>
      )}
    </div>
  );
}
