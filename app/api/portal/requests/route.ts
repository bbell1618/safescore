import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPortalApiAccess } from "@/lib/portal/access";
import { tierHasFeature } from "@/lib/tiers";

export async function GET() {
  const access = await getPortalApiAccess("evidence_requests");
  if (access.status === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.status !== "linked") return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  if (!access.allowed) return NextResponse.json({ error: "Evidence requests are not included in this plan" }, { status: 403 });
  const service = await createServiceClient();
  let query = service
    .from("client_requests")
    .select("id, category, title, description, source, requested_items, status, due_at, reminder_count, created_at")
    .eq("client_id", access.clientId)
    .eq("responsibility", "client");
  if (!tierHasFeature(access.tier, "compliance_layer")) {
    query = query.neq("category", "mcs150_truth_up");
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}
