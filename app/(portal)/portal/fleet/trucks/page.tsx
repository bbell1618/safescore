import type { Metadata } from "next";
import Link from "next/link";
import { TruckListEditor } from "@/components/portal/fleet-editor";
import { loadSetupChecklist } from "@/lib/autopilot/setup-checklist";
import { getPortalClientPageContext } from "@/lib/portal/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your trucks | Golden Era SafeScore" };

/** QF-223: the whole truck and trailer list on one page, confirmed with one button. */
export default async function PortalTrucksPage() {
  const context = await getPortalClientPageContext();
  const data = await loadSetupChecklist(context.clientId);
  if (!data) return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:py-8">
      <Link href="/portal" className="inline-block px-1 text-sm font-semibold text-navy underline decoration-amber decoration-2 underline-offset-4">Back to home</Link>
      <TruckListEditor token={data.planToken} trucks={data.trucks.list} note={data.trucks.note} fromFile={data.fromClientFile} />
    </div>
  );
}
