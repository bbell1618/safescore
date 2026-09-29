import { NextResponse } from "next/server";
import { clientForPlanToken } from "@/lib/autopilot/plan-page-server";
import { handleClientRequestUpload } from "@/lib/request-queue/client-upload";
import { normalizeClientTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ token: string; requestId: string }> }) {
  const { token, requestId } = await params;
  const client = await clientForPlanToken(token).catch(() => null);
  if (!client) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  // The shared handler scopes the request to this client id, so a request id
  // from another carrier can never be reached through this link.
  return handleClientRequestUpload(request, requestId, { clientId: client.id, userId: null, tier: normalizeClientTier(client.tier) });
}
