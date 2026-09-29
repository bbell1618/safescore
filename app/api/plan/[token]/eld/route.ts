import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = cleanString(body.provider, 80);
    const method = body.method === "added_user" || body.method === "need_help" ? body.method : null;
    if (!provider) return NextResponse.json({ error: "Tell us which ELD you use." }, { status: 400 });
    if (!method) return NextResponse.json({ error: "Choose one option." }, { status: 400 });
    const { error } = await serviceClient().from("clients").update({ eld_provider: provider }).eq("id", client.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlanEvent(
      client.id,
      method === "added_user" ? "plan_eld_access_confirmed" : "plan_eld_help_requested",
      method === "added_user" ? `Carrier says Sunny was added as a read-only user in ${provider}` : `Carrier needs help giving ${provider} access`,
      { provider, method }
    );
    return NextResponse.json({ ok: true });
  });
}
