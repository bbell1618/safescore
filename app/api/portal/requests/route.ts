import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = await createServiceClient();
  const { data: userRow } = await service.from("users").select("client_id").eq("id", user.id).single();
  if (!userRow?.client_id) return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  const { data, error } = await service
    .from("client_requests")
    .select("id, category, title, description, source, requested_items, status, due_at, reminder_count, created_at")
    .eq("client_id", userRow.client_id)
    .eq("responsibility", "client")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}
