import { NextResponse } from "next/server";
import { clientForPlanToken } from "@/lib/autopilot/plan-page-server";
import { handleClientRequestAnswer } from "@/lib/request-queue/client-answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string; requestId: string }> }) {
  const { token, requestId } = await params;
  const client = await clientForPlanToken(token).catch(() => null);
  if (!client) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  return handleClientRequestAnswer(request, requestId, { clientId: client.id, userId: null });
}
