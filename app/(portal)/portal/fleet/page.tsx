import type { Metadata } from "next";
import { DriversPanel, TrucksPanel } from "@/components/portal/setup-checklist";
import { loadSetupChecklist } from "@/lib/autopilot/setup-checklist";
import { setupItemStates } from "@/lib/autopilot/setup-items";
import { getPortalClientPageContext } from "@/lib/portal/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Drivers and trucks | Golden Era SafeScore" };

/** QF-221/223: the carrier opens either one-page list from here any time. */
export default async function PortalFleetPage() {
  const context = await getPortalClientPageContext();
  const data = await loadSetupChecklist(context.clientId);
  if (!data) return null;
  const state = Object.fromEntries(setupItemStates(data).map((x) => [x.key, x.done]));
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:py-10">
      <div className="px-1">
        <h1 className="font-heading text-3xl text-navy">Drivers and trucks</h1>
        <p className="mt-1 text-sm text-warm-mid">Keep these two lists right. We match every inspection to a driver and a truck, so a wrong list means wrong advice. Open a list when a driver joins or leaves, or a truck is added or sold.</p>
      </div>
      <DriversPanel drivers={data.drivers.list} fromFile={data.fromClientFile} done={Boolean(state.drivers)} />
      <TrucksPanel trucks={data.trucks.list} fromFile={data.fromClientFile} confirmed={Boolean(state.trucks)} />
    </div>
  );
}
