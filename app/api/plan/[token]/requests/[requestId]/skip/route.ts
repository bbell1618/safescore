import { NextResponse } from "next/server";
import { clientForPlanToken } from "@/lib/autopilot/plan-page-server";
import { logPlanEvent } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";

export const dynamic = "force-dynamic";

/**
 * QF-221: "I do not have this". Closes a document ask so the carrier's list can reach done.
 * QF-225: any ask on the setup list, not only the sign-up documents. Court paperwork and other
 * evidence asks come from the case engine with their own category and were refused before
 * ("This item is already closed"). Cancelled is the same end state the evidence loop uses.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string; requestId: string }> }) {
  const { token, requestId } = await params;
  const client = await clientForPlanToken(token).catch(() => null);
  if (!client) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const service = serviceClient();
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("client_requests")
    .update({ status: "cancelled", closed_at: now, next_reminder_at: null, updated_at: now, status_copy: "The carrier said they do not have this.", response: { skipped: true, at: now } })
    .eq("id", requestId)
    .eq("client_id", client.id)
    .eq("responsibility", "client")
    .eq("status", "open")
    .select("title")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Already closed (another tab, or Golden Era closed it): nothing to fix, just refresh the list.
  if (!data) return NextResponse.json({ ok: true, alreadyClosed: true });
  await logPlanEvent(client.id, "carrier_request_skipped", `Carrier does not have: ${data.title}`, { requestId });
  return NextResponse.json({ ok: true });
}
