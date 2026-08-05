import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; evidId: string }> }
) {
  const { id, evidId } = await params;
  const supabase = getAdmin();

  const { data: ev, error: evErr } = await supabase
    .from("cpdp_evidence")
    .select("id, case_id, storage_path, status, document_id")
    .eq("id", evidId)
    .eq("case_id", id)
    .single();

  if (evErr || !ev) {
    return NextResponse.json(
      { error: "Evidence item not found for this case." },
      { status: 404 }
    );
  }

  let bucket = "dataq-evidence";
  let storagePath = ev.storage_path as string | null;

  if (ev.document_id) {
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", ev.document_id)
      .single();

    if (documentError || !document?.storage_path) {
      return NextResponse.json(
        {
          error: `Linked document could not be resolved: ${
            documentError?.message ?? "storage path missing"
          }`,
        },
        { status: 500 }
      );
    }

    bucket = "documents";
    storagePath = document.storage_path as string;
  }

  if (!storagePath) {
    return NextResponse.json(
      { error: "No file has been uploaded for this evidence item." },
      { status: 404 }
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Failed to generate signed URL: ${signErr?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
