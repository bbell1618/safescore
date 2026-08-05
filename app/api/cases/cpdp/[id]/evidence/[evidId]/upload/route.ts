import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  ingestPar,
  PAR_FUNCTION_UPLOAD_MAX_BYTES,
  ParIntakeError,
} from "@/lib/cpdp/par-intake-server";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; evidId: string }> }
) {
  const { id, evidId } = await params;
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const staff = await service.from("users").select("role").eq("id", user.id).single();
  if (staff.error) {
    return NextResponse.json({ error: `Unable to verify staff access: ${staff.error.message}` }, { status: 500 });
  }
  if (!staff.data || !["geia_admin", "geia_staff"].includes(staff.data.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PAR file provided." }, { status: 400 });
  }
  if (file.size > PAR_FUNCTION_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: "PAR exceeds the 3 MB browser-upload limit. Use the configured LexisNexis URL-delivery integration for larger files." },
      { status: 413 }
    );
  }

  try {
    const evidence = await service
      .from("cpdp_evidence")
      .select("id, doc_type")
      .eq("id", evidId)
      .eq("case_id", id)
      .single();
    if (evidence.error || !evidence.data) {
      return NextResponse.json({ error: evidence.error?.message ?? "Evidence row not found" }, { status: 404 });
    }
    if (evidence.data.doc_type !== "police_report") {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
      const storagePath = `cpdp-cases/${id}/${evidId}/${crypto.randomUUID()}-${safeName}`;
      const upload = await service.storage.from("dataq-evidence").upload(
        storagePath,
        Buffer.from(await file.arrayBuffer()),
        { contentType: file.type || "application/octet-stream", upsert: false }
      );
      if (upload.error) {
        return NextResponse.json({ error: `Evidence upload failed: ${upload.error.message}` }, { status: 500 });
      }
      const update = await service.from("cpdp_evidence").update({
        status: "received",
        storage_path: storagePath,
        uploaded_at: new Date().toISOString(),
        uploaded_by: user.id,
      }).eq("id", evidId);
      if (update.error) {
        return NextResponse.json({ error: `Evidence was stored but its row could not be updated: ${update.error.message}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const result = await ingestPar(service, {
      caseId: id,
      evidenceId: evidId,
      filename: file.name,
      declaredMimeType: file.type || null,
      bytes: Buffer.from(await file.arrayBuffer()),
      source: "manual",
      actorUserId: user.id,
    });
    return NextResponse.json({
      ok: true,
      idempotent: result.alreadyReceived,
      documentId: result.documentId,
      assessment: result.assessment,
      suggestedTypes: result.suggestedTypes,
    });
  } catch (error) {
    if (error instanceof ParIntakeError) {
      return NextResponse.json(
        { error: error.message, stored: error.stored, ...error.identifiers },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PAR intake failed" },
      { status: 500 }
    );
  }
}
