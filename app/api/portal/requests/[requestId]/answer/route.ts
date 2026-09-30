import { NextResponse } from "next/server";
import { getPortalApiAccess } from "@/lib/portal/access";
import { handleClientRequestAnswer } from "@/lib/request-queue/client-answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const access = await getPortalApiAccess("evidence_requests");
  if (access.status === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.status !== "linked") return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  if (!access.allowed) return NextResponse.json({ error: "Evidence requests are not included in this plan" }, { status: 403 });
  return handleClientRequestAnswer(request, requestId, { clientId: access.clientId, userId: access.userId });
}
