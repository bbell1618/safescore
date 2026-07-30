import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendReportReady } from "@/lib/email/client";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: report, error: reportError } = await serviceSupabase
    .from("reports")
    .select("id, client_id, title, type, status, created_at")
    .eq("id", id)
    .single() as any;

  if (reportError || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // ── 3. Find client email ─────────────────────────────────────────────────────
  // First try users table for a client_user associated with this client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clientUser } = await serviceSupabase
    .from("users")
    .select("email")
    .eq("client_id", report.client_id)
    .eq("role", "client_user")
    .limit(1)
    .single() as any;

  let clientEmail: string | null = clientUser?.email ?? null;

  if (!clientEmail) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invite } = await serviceSupabase
      .from("client_invites")
      .select("email")
      .eq("client_id", report.client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as any;

    clientEmail = invite?.email ?? null;
  }

  // ── 4. Fetch client name for email ───────────────────────────────────────────
  const { data: clientRecord } = await serviceSupabase
    .from("clients")
    .select("name")
    .eq("id", report.client_id)
    .single() as any;

  // ── 5. Update report status to sent ─────────────────────────────────────────
  const { error: updateError } = await serviceSupabase
    .from("reports")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: user.id })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── 6. Log to activity_log ───────────────────────────────────────────────────
  await serviceSupabase.from("activity_log").insert({
    client_id: report.client_id,
    action_type: "report_sent",
    entity_type: "reports",
    entity_id: id,
    description: `Report "${report.title}" marked as sent${clientEmail ? ` to ${clientEmail}` : ""}`,
  });

  // ── 7. Send report-ready email ───────────────────────────────────────────────
  let emailSent = false;
  if (clientEmail && clientRecord) {
    const reportDate = new Date(report.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/documents#from-geia`;
    const result = await sendReportReady({
      to: clientEmail,
      companyName: clientRecord.name,
      reportTitle: report.title,
      reportDate,
      portalUrl,
    });
    emailSent = result.success;
  } else {
    console.log(
      `Report ${id} sent but no client email found — skipping notification`
    );
  }

  return NextResponse.json({ success: true, clientEmail, emailSent });
}
