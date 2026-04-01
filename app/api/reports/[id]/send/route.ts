import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = await createServiceClient();

  const { data: userRecord } = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single() as any;

  const role: string = userRecord?.role ?? "client_user";

  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 2. Fetch report ──────────────────────────────────────────────────────────
  const { data: report, error: reportError } = await serviceSupabase
    .from("reports")
    .select("id, client_id, title, type, status")
    .eq("id", id)
    .single() as any;

  if (reportError || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // ── 3. Find client email ─────────────────────────────────────────────────────
  // First try users table for a client_user associated with this client
  const { data: clientUser } = await serviceSupabase
    .from("users")
    .select("email")
    .eq("client_id", report.client_id)
    .eq("role", "client_user")
    .limit(1)
    .single() as any;

  // Fallback: check client_invites table for the most recent invite
  let clientEmail: string | null = clientUser?.email ?? null;

  if (!clientEmail) {
    const { data: invite } = await serviceSupabase
      .from("client_invites")
      .select("email")
      .eq("client_id", report.client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as any;

    clientEmail = invite?.email ?? null;
  }

  // ── 4. Update report status to sent ─────────────────────────────────────────
  const { error: updateError } = await serviceSupabase
    .from("reports")
    .update({ status: "sent" })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── 5. Log to activity_log ───────────────────────────────────────────────────
  await serviceSupabase.from("activity_log").insert({
    client_id: report.client_id,
    action_type: "report_sent",
    entity_type: "reports",
    entity_id: id,
    description: `Report "${report.title}" marked as sent${clientEmail ? ` to ${clientEmail}` : ""}`,
  });

  // ── 6. Email sending TODO ────────────────────────────────────────────────────
  console.log(
    `Email sending not yet implemented — report ${id} marked as sent` +
    (clientEmail ? ` (client email: ${clientEmail})` : " (no client email found)")
  );

  return NextResponse.json({ success: true, clientEmail });
}
