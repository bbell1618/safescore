import { NextResponse } from "next/server";
import { logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { activeDriverCount, applyBilledDriverCount, priceChange } from "@/lib/billing/driver-pricing";

export const dynamic = "force-dynamic";

/**
 * QF-227: the carrier agrees to the price for the driver list as it stands now (after a change
 * made from the agency side). The count must match what they were shown, so a list that changed
 * again in between is never charged without being shown first.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as { drivers?: unknown };
    const service = serviceClient();
    const active = await activeDriverCount(service, client.id);
    const { data: billing } = await service.from("clients").select("tier, status, billed_driver_count").eq("id", client.id).maybeSingle();
    const change = billing?.status === "active" ? priceChange(billing.tier, billing.billed_driver_count, active) : null;
    if (!change) return NextResponse.json({ ok: true, nothingToConfirm: true });
    if (Number(body.drivers) !== active) {
      return NextResponse.json({ error: "Your driver list changed. Please look at the new price.", priceChange: change }, { status: 409 });
    }
    const result = await applyBilledDriverCount(service, client.id, active, client.email ?? "carrier");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    await logPlanEvent(client.id, "carrier_driver_price_confirmed", `Carrier confirmed ${active} drivers and the new monthly price`, { ...change });
    return NextResponse.json({ ok: true, change });
  });
}
