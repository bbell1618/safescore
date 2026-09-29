import "server-only";
import { NextResponse } from "next/server";
import { clientForPlanToken, type PlanClient } from "./plan-page-server";
import { serviceClient } from "./queue";

export async function withPlanClient(
  params: Promise<{ token: string }>,
  handler: (client: PlanClient) => Promise<Response>
): Promise<Response> {
  const { token } = await params;
  try {
    const client = await clientForPlanToken(token);
    if (!client) return NextResponse.json({ error: "This link is not valid. Reply to our email and we will send a new one." }, { status: 404 });
    return await handler(client);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function logPlanEvent(clientId: string, action: string, description: string, metadata: Record<string, unknown> = {}) {
  await serviceClient().from("activity_log").insert({
    client_id: clientId,
    action_type: action,
    entity_type: "client",
    entity_id: clientId,
    description,
    metadata: { via: "plan_link", ...metadata },
  });
}

export function cleanString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
