import { NextResponse } from "next/server";
import { clientForPlanToken } from "@/lib/autopilot/plan-page-server";
import { logPlanEvent } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { INTAKE_CATEGORY } from "@/lib/autopilot/setup-checklist";

export const dynamic = "force-dynamic";

/** QF-221: "I do not have this". Closes a document ask so the carrier's list can reach done. */
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
    .eq("category", INTAKE_CATEGORY)
    .eq("status", "open")
    .select("title")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This item is already closed." }, { status: 409 });
  await logPlanEvent(client.id, "carrier_request_skipped", `Carrier does not have: ${data.title}`, { requestId });
  return NextResponse.json({ ok: true });
}
