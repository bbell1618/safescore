import type { Metadata } from "next";
import { DriversPanel, TrucksPanel } from "@/components/portal/setup-checklist";
import { loadSetupChecklist } from "@/lib/autopilot/setup-checklist";
import { getPortalClientPageContext } from "@/lib/portal/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Drivers and trucks | Golden Era SafeScore" };

/** QF-221: the carrier can open and correct their driver list and truck list any time. */
export default async function PortalFleetPage() {
  const context = await getPortalClientPageContext();
  const data = await loadSetupChecklist(context.clientId);
  if (!data) return null;
  const driversDone = Boolean(data.drivers.submittedAt) || (data.drivers.list.length > 0 && data.drivers.list.every((d) => d.confirmed));
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:py-10">
      <div className="px-1">
        <h1 className="font-heading text-3xl text-navy">Drivers and trucks</h1>
        <p className="mt-1 text-sm text-warm-mid">Keep these two lists right. We match every inspection to a driver and a truck, so a wrong list means wrong advice. Tell us here when a driver joins or leaves, or a truck is added or sold.</p>
      </div>
      <DriversPanel token={data.planToken} drivers={data.drivers.list} rosterUrl={data.drivers.rosterUrl} fromFile={data.fromClientFile} done={driversDone} />
      <TrucksPanel token={data.planToken} trucks={data.trucks.list} note={data.trucks.note} fromFile={data.fromClientFile} confirmed={Boolean(data.trucks.confirmedAt)} />
    </div>
  );
}
