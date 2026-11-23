import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ingestFmcsaExport } from "@/lib/fmcsa/ingest-export";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireStaff();
  if (authError) return authError;

  const parsedInput = await readInput(request);
  if (!parsedInput.ok) {
    return NextResponse.json({ error: parsedInput.error }, { status: parsedInput.status });
  }
  return ingestFmcsaExport(parsedInput);
}

async function requireStaff() {
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

  return null;
}

async function readInput(request: NextRequest): Promise<
  | { ok: true; clientId: string | null; dotNumber: string | null; content: string; filename: string | null }
  | { ok: false; error: string; status: number }
> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const contentField = form.get("xml") ?? form.get("content");
    const content =
      file instanceof File
        ? await file.text()
        : typeof contentField === "string"
          ? contentField
          : "";
    return {
      ok: true,
      clientId: stringOrNull(form.get("clientId")),
      dotNumber: stringOrNull(form.get("dotNumber")),
      content,
      filename: file instanceof File ? file.name : stringOrNull(form.get("filename")),
    };
  }

  const content = await request.text();
  return {
    ok: true,
    clientId: request.nextUrl.searchParams.get("clientId"),
    dotNumber: request.nextUrl.searchParams.get("dotNumber"),
    content,
    filename: request.nextUrl.searchParams.get("filename"),
  };
}

function stringOrNull(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : null;
}
