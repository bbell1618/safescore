import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return NextResponse.json({ documents: [] });
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("id, filename, category, file_size, created_at, status")
    .eq("client_id", userRecord.client_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ documents: documents ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return NextResponse.json({ error: "No client associated with account" }, { status: 400 });
  }

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

  const storagePath = `${userRecord.client_id}/${Date.now()}-${file.name}`;

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
    client_id: userRecord.client_id,
    storage_path: storagePath,
    filename: file.name,
    file_size: file.size,
    mime_type: file.type,
    category: category as any,
    uploaded_by: user.id,
  });

  if (dbError) {
    return NextResponse.json({ error: "Failed to record document" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
