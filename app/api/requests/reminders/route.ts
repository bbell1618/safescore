import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = await createServiceClient();
  const { data: staff } = await service.from("users").select("role").eq("id", user.id).single();
  if (!staff || !["geia_admin", "geia_staff"].includes(staff.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const { data: rows, error } = await service
    .from("client_requests")
    .select("id, client_id, title, reminder_count, reminder_limit, reminder_interval_days, clients(name)")
    .eq("status", "open")
    .eq("responsibility", "client")
    .lte("next_reminder_at", now.toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const row of rows ?? []) {
    const { data: recipient } = await service.from("users").select("email").eq("client_id", row.client_id).eq("role", "client_user").limit(1).maybeSingle();
    const nextCount = row.reminder_count + 1;
    const escalated = nextCount >= row.reminder_limit;
    const nextAt = escalated ? null : new Date(now.getTime() + row.reminder_interval_days * 86400000).toISOString();
    const { error: updateError } = await service.from("client_requests").update({ reminder_count: nextCount, last_reminded_at: now.toISOString(), next_reminder_at: nextAt, escalated_at: escalated ? now.toISOString() : null, updated_at: now.toISOString() }).eq("id", row.id).eq("status", "open");
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    const log = { mode: "dry-run", trigger: "request_queue_reminder", recipient: recipient?.email ?? "NO_CLIENT_EMAIL", subject: `SafeScore request reminder: ${row.title}`, template: "request_queue_reminder", requestId: row.id, reminderCount: nextCount, escalated };
    console.log("EMAIL_DRY_RUN", JSON.stringify(log));
    results.push(log);
  }
  return NextResponse.json({ processed: results.length, results });
}
