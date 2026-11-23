import type { Metadata } from "next";
import Link from "next/link";
import { DriverListEditor } from "@/components/portal/fleet-editor";
import { loadSetupChecklist } from "@/lib/autopilot/setup-checklist";
import { getPortalClientPageContext } from "@/lib/portal/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your drivers | Golden Era SafeScore" };

/** QF-223: the whole driver list on one page, confirmed with one button. */
export default async function PortalDriversPage() {
  const context = await getPortalClientPageContext();
  const data = await loadSetupChecklist(context.clientId);
  if (!data) return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:py-8">
      <Link href="/portal#todo" className="inline-block px-1 text-sm font-semibold text-amber-dark underline">Back to your setup list</Link>
      <DriverListEditor token={data.planToken} drivers={data.drivers.list} fromFile={data.fromClientFile} />
    </div>
  );
}
