import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { REQUEST_UPLOAD_MAX_BYTES, REQUEST_UPLOAD_MIMES, safeFilename } from "@/lib/request-queue/upload";
import { syncClientEvidenceRequest, type RequestedEvidenceItem } from "@/lib/request-queue/sync";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = await createServiceClient();
  const { data: userRow } = await service.from("users").select("client_id").eq("id", user.id).single();
  if (!userRow?.client_id) return NextResponse.json({ error: "Client account not linked" }, { status: 403 });

  const { data: queueItem } = await service
    .from("client_requests")
    .select("id, client_id, category, requested_items, status")
    .eq("id", requestId)
    .eq("client_id", userRow.client_id)
    .eq("responsibility", "client")
    .maybeSingle();
  if (!queueItem || queueItem.status !== "open") {
    return NextResponse.json({ error: "Open request not found" }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const evidenceId = form.get("evidenceId");
  if (!(file instanceof File)) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (file.size > REQUEST_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "File exceeds 25 MB" }, { status: 422 });
  if (!REQUEST_UPLOAD_MIMES.has(file.type)) return NextResponse.json({ error: "File type not allowed" }, { status: 422 });

  const stamp = Date.now();
  if (queueItem.category === "case_evidence") {
    if (typeof evidenceId !== "string") return NextResponse.json({ error: "Evidence item is required" }, { status: 400 });
    const items = (queueItem.requested_items ?? []) as RequestedEvidenceItem[];
    const item = items.find((candidate) => candidate.evidenceId === evidenceId);
    if (!item) return NextResponse.json({ error: "Evidence item is not part of this request" }, { status: 403 });
    const table = item.caseType === "dataq" ? "dataq_evidence" : "cpdp_evidence";
    const { data: evidence } = await service.from(table).select("id, case_id").eq("id", evidenceId).eq("case_id", item.caseId).single();
    if (!evidence) return NextResponse.json({ error: "Evidence slot not found" }, { status: 404 });
    const storagePath = `cases/${item.caseId}/${evidenceId}/${stamp}-${safeFilename(file.name)}`;
    const { error: storageError } = await service.storage.from("dataq-evidence").upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (storageError) return NextResponse.json({ error: storageError.message }, { status: 500 });
    const { error: updateError } = await service.from(table).update({ status: "received", storage_path: storagePath, uploaded_at: new Date().toISOString(), uploaded_by: "client" }).eq("id", evidenceId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    const sync = await syncClientEvidenceRequest(service, userRow.client_id);
    return NextResponse.json({ ok: true, evidenceId, requestStatus: sync.status, remaining: sync.itemCount });
  }

  const storagePath = `${userRow.client_id}/requests/${requestId}/${stamp}-${safeFilename(file.name)}`;
  const { error: storageError } = await service.storage.from("documents").upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (storageError) return NextResponse.json({ error: storageError.message }, { status: 500 });
  const category = queueItem.category === "dqf_roster" ? "dqf" : "other";
  const { data: documentRow, error: documentError } = await service.from("documents").insert({ client_id: userRow.client_id, storage_path: storagePath, filename: file.name, file_size: file.size, mime_type: file.type, category, status: "pending_review", uploaded_by: user.id }).select("id").single();
  if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });
  const now = new Date().toISOString();
  const { error: closeError } = await service.from("client_requests").update({ status: "fulfilled", closed_at: now, next_reminder_at: null, updated_at: now }).eq("id", requestId);
  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });
  return NextResponse.json({ ok: true, documentId: documentRow.id, requestStatus: "fulfilled", remaining: 0 });
}
