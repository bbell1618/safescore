import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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

const ALLOWED_EXTS = new Set([
  "pdf", "doc", "docx", "tif", "tiff", "txt", "xls", "xlsx",
  "jpg", "jpeg", "gif", "png",
]);

const MAX_SIZE = 26214400; // 25 MB

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; evidId: string }> }
) {
  const { id, evidId } = await params;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");

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

  // Verify evidence item belongs to this case
  const { data: ev, error: evErr } = await supabase
    .from("dataq_evidence")
    .select("id, case_id")
    .eq("id", evidId)
    .eq("case_id", id)
    .single();

  if (evErr || !ev) {
    return NextResponse.json(
      { error: "Evidence item not found for this case." },
      { status: 404 }
    );
  }

  // Build storage path
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `cases/${id}/${evidId}/${sanitizedName}`;

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

  // Mark evidence as received, uploaded_by='geia'
  const { error: updateErr } = await supabase
    .from("dataq_evidence")
    .update({
      status: "received",
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      uploaded_by: "geia",
    })
    .eq("id", evidId);

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update evidence record: ${updateErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
