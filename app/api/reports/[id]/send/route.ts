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

  const { data: userRecord } = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const role: string = userRecord?.role ?? "client_user";

  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 2. Fetch report ──────────────────────────────────────────────────────────
  const { data: report, error: reportError } = await serviceSupabase
    .from("reports")
    .select("id, client_id, title, type, status, created_at")
    .eq("id", id)
    .single();

  if (reportError || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  if (report.status !== "reviewed") {
    return NextResponse.json(
      { error: "Only reviewed reports can be sent" },
      { status: 409 }
    );
  }

  // ── 3. Find client email ─────────────────────────────────────────────────────
  // First try users table for a client_user associated with this client
  const { data: clientUser } = await serviceSupabase
    .from("users")
    .select("email")
    .eq("client_id", report.client_id)
    .eq("role", "client_user")
    .limit(1)
    .single();

  let clientEmail: string | null = clientUser?.email ?? null;

  if (!clientEmail) {
    const { data: invite } = await serviceSupabase
      .from("client_invites")
      .select("email")
      .eq("client_id", report.client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    clientEmail = invite?.email ?? null;
  }

  // ── 4. Fetch client name for email ───────────────────────────────────────────
  const { data: clientRecord } = await serviceSupabase
    .from("clients")
    .select("name")
    .eq("id", report.client_id)
    .single();

  // ── 5. Atomically claim the reviewed -> sent transition ─────────────────────
  // The reviewed predicate prevents two concurrent requests from both sending a
  // client notification. Only the request that changes the row may continue.
  const sentAt = new Date().toISOString();
  const { data: sentReport, error: updateError } = await serviceSupabase
    .from("reports")
    .update({ status: "sent", sent_at: sentAt, sent_by: user.id })
    .eq("id", id)
    .eq("status", "reviewed")
    .select("id, status, sent_at")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!sentReport) {
    return NextResponse.json(
      {
        error:
          "Report status changed before it could be sent. Reload and review the current status.",
      },
      { status: 409 }
    );
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
  // Email delivery is fail-closed: every value except an explicit "false"
  // means delivery is suppressed. Keep that truth in the response even when
  // no recipient is available and the email helper is therefore not called.
  let dryRun =
    process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false";
  let emailError: string | null = null;
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
    dryRun = result.dryRun === true;
    emailSent = result.success && !dryRun;
    emailError = result.success ? null : (result.error ?? "Email delivery failed");
  } else {
    emailError = clientEmail
      ? "Client record was not found for the notification"
      : "No client email address was found for the notification";
    console.log(
      `Report ${id} sent but no client email found — skipping notification`
    );
  }

  return NextResponse.json({
    success: true,
    report: {
      id: sentReport.id,
      status: sentReport.status,
      sent_at: sentReport.sent_at,
    },
    clientEmail,
    emailSent,
    dryRun,
    emailError,
  });
}
