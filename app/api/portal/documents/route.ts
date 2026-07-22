import { NextResponse } from "next/server";
import { getPortalApiAccess } from "@/lib/portal/access";

export async function GET() {
  const access = await getPortalApiAccess("compliance_layer");
  if (access.status === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.status !== "linked") return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  if (!access.allowed) return NextResponse.json({ error: "The compliance document vault is not included in this plan" }, { status: 403 });

  const { data: documents, error } = await access.supabase
    .from("documents")
    .select("id, filename, category, file_size, created_at, status")
    .eq("client_id", access.clientId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ documents: documents ?? [] });
}

export async function POST(request: Request) {
  const access = await getPortalApiAccess("compliance_layer");
  if (access.status === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.status !== "linked") return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  if (!access.allowed) return NextResponse.json({ error: "The compliance document vault is not included in this plan" }, { status: 403 });
  const supabase = access.supabase;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) ?? "other";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const maxSize = 25 * 1024 * 1024; // 25 MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File exceeds 25 MB limit" }, { status: 400 });
  }

  const storagePath = `${access.clientId}/${Date.now()}-${file.name}`;

  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file);

  if (storageError) {
    return NextResponse.json(
      { error: "Upload failed: " + storageError.message },
      { status: 500 }
    );
  }

  const { error: dbError } = await supabase.from("documents").insert({
    client_id: access.clientId,
    storage_path: storagePath,
    filename: file.name,
    file_size: file.size,
    mime_type: file.type,
    category: category as any,
    uploaded_by: access.userId,
  });

  if (dbError) {
    return NextResponse.json({ error: "Failed to record document" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
