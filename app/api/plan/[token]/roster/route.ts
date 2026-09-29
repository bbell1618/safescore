import { NextResponse } from "next/server";
import { withPlanClient } from "@/lib/autopilot/plan-actions";
import { ensureRosterRequest } from "@/lib/autopilot/plan-page-server";
import { appUrl } from "@/lib/autopilot/intake";
import { serviceClient } from "@/lib/autopilot/queue";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const token = await ensureRosterRequest(serviceClient(), client.id);
    return NextResponse.json({ url: `${appUrl()}/roster/${token}` });
  });
}
