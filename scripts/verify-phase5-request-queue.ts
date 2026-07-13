import { createClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const clientEmail = "safescore-phase11-acme@example.com";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function clientCookie() {
  const { data: listed } = await service.auth.admin.listUsers({ perPage: 1000 });
  let authUser = listed.users.find((user) => user.email === clientEmail);
  if (!authUser) {
    const created = await service.auth.admin.createUser({ email: clientEmail, email_confirm: true, user_metadata: { role: "client_user" } });
    if (created.error || !created.data.user) throw created.error ?? new Error("Client auth user creation failed");
    authUser = created.data.user;
  }
  const userUpsert = await service.from("users").upsert({ id: authUser.id, client_id: clientId, email: clientEmail, full_name: "Phase 11 Test Client", role: "client_user" }, { onConflict: "id" });
  if (userUpsert.error) throw userUpsert.error;
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email: clientEmail, options: { redirectTo: `${baseUrl}/auth/callback?next=/portal/requests` } });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("Client login link failed");
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("Client session failed");
  const key = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  return createChunks(key, `base64-${stringToBase64URL(JSON.stringify(verified.data.session))}`).map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function main() {
  const existingCase = await service.from("dataq_cases").select("id").eq("client_id", clientId).eq("case_number", "TEST-P5-REQUEST-QUEUE").maybeSingle();
  if (existingCase.error) throw existingCase.error;
  let caseId = existingCase.data?.id;
  if (!caseId) {
    const inserted = await service.from("dataq_cases").insert({ client_id: clientId, case_number: "TEST-P5-REQUEST-QUEUE", status: "draft", priority: "medium" }).select("id").single();
    if (inserted.error) throw inserted.error;
    caseId = inserted.data.id;
  }
  const existingEvidence = await service.from("dataq_evidence").select("id").eq("case_id", caseId).eq("doc_type", "phase5_test_document").maybeSingle();
  if (existingEvidence.error) throw existingEvidence.error;
  let evidenceId = existingEvidence.data?.id;
  if (!evidenceId) {
    const inserted = await service.from("dataq_evidence").insert({ case_id: caseId, doc_type: "phase5_test_document", label: "Synthetic driver statement", context_note: "Phase 5 request-queue lifecycle fixture", required: true, status: "needed", acquisition_method: "client_upload", needed_reason: "Synthetic gate proof" }).select("id").single();
    if (inserted.error) throw inserted.error;
    evidenceId = inserted.data.id;
  }
  const requestRow = await service.from("client_requests").upsert({ client_id: clientId, dedupe_key: `${clientId}:case:phase5-gate`, category: "case_evidence", title: "Phase 5 synthetic evidence request", description: "Synthetic lifecycle gate", source: "case", responsibility: "client", requested_items: [{ caseType: "dataq", caseId, evidenceId, label: "Synthetic driver statement", contextNote: "Phase 5 request-queue lifecycle fixture" }], status: "open", reminder_count: 0, reminder_limit: 3, reminder_interval_days: 7, next_reminder_at: new Date(Date.now() - 60000).toISOString(), closed_at: null, escalated_at: null }).select("id").single();
  if (requestRow.error) throw requestRow.error;
  const requestId = requestRow.data.id;

  const cookie = await clientCookie();
  const portal = await fetch(`${baseUrl}/portal/requests`, { headers: { cookie }, redirect: "manual" });
  const portalHtml = await portal.text();
  if (portal.status !== 200 || !portalHtml.includes("Phase 5 synthetic evidence request")) throw new Error(`Portal proof failed: ${portal.status}`);

  const staff = await createDeployedStaffSession(baseUrl);
  let reminderBody: any;
  try {
    const reminder = await fetch(`${baseUrl}/api/requests/reminders`, { method: "POST", headers: { cookie: staff.cookie } });
    reminderBody = await reminder.json();
    if (!reminder.ok) throw new Error(JSON.stringify(reminderBody));
  } finally { await staff.revoke(); }
  const log = reminderBody.results.find((row: any) => row.requestId === requestId);
  if (!log || log.mode !== "dry-run" || log.reminderCount !== 1) throw new Error("Reminder dry-run proof missing");

  const form = new FormData();
  form.set("evidenceId", evidenceId);
  form.set("file", new File(["SafeScore Phase 5 synthetic evidence fixture\n"], "phase5-evidence.txt", { type: "text/plain" }));
  const upload = await fetch(`${baseUrl}/api/portal/requests/${requestId}/upload`, { method: "POST", headers: { cookie }, body: form });
  const uploadBody = await upload.json();
  if (!upload.ok) throw new Error(JSON.stringify(uploadBody));

  const [{ data: queue }, { data: evidence }] = await Promise.all([
    service.from("client_requests").select("id,status,reminder_count,next_reminder_at,closed_at").eq("id", requestId).single(),
    service.from("dataq_evidence").select("id,case_id,status,storage_path,uploaded_by").eq("id", evidenceId).single(),
  ]);
  console.log(JSON.stringify({ clientId, caseId, evidenceId, requestId, portal: { status: portal.status, renderedTitle: true }, reminder: log, upload: uploadBody, queue, evidence }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
