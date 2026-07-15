import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/tiff",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/gif",
  "image/png",
]);

// Extension-based fallback for browsers that report empty MIME type
const ALLOWED_EXTS = new Set([
  "pdf", "doc", "docx", "tif", "tiff", "txt", "xls", "xlsx",
  "jpg", "jpeg", "gif", "png",
]);

const MAX_SIZE = 26214400; // 25 MB

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const evidenceId = formData.get("evidence_id");
  const file = formData.get("file");

  if (!evidenceId || typeof evidenceId !== "string") {
    return NextResponse.json({ error: "Missing evidence_id." }, { status: 400 });
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // Validate file type
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_MIMES.has(file.type) && !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({ error: "File type not allowed." }, { status: 422 });
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds the 25 MB size limit." }, { status: 422 });
  }

  const supabase = getAdmin();

  // Validate token — not expired
  const { data: req, error: reqErr } = await supabase
    .from("dataq_evidence_request")
    .select("id, case_id, expires_at")
    .eq("token", token)
    .single();

  if (reqErr || !req) {
    return NextResponse.json(
      { error: "This link is invalid or has expired." },
      { status: 404 }
    );
  }

  if (new Date(req.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This link has expired." },
      { status: 410 }
    );
  }

  // Verify evidence_id belongs to this case
  const { data: evidenceRow, error: evErr } = await supabase
    .from("dataq_evidence")
    .select("id, case_id")
    .eq("id", evidenceId)
    .eq("case_id", req.case_id)
    .single();

  if (evErr || !evidenceRow) {
    return NextResponse.json(
      { error: "Evidence item not found for this case." },
      { status: 404 }
    );
  }

  // Build storage path
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `cases/${req.case_id}/${evidenceId}/${sanitizedName}`;

  // Upload to Supabase Storage
  const fileBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from("dataq-evidence")
    .upload(storagePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  // Update evidence record
  const { error: updateErr } = await supabase
    .from("dataq_evidence")
    .update({
      status: "received",
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      uploaded_by: "client",
    })
    .eq("id", evidenceId)
    .eq("case_id", req.case_id);

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update evidence record: ${updateErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
