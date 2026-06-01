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

  // Fetch evidence row and verify it belongs to this case
  const { data: ev, error: evErr } = await supabase
    .from("dataq_evidence")
    .select("id, case_id, storage_path, status")
    .eq("id", evidId)
    .eq("case_id", id)
    .single();

  if (evErr || !ev) {
    return NextResponse.json(
      { error: "Evidence item not found for this case." },
      { status: 404 }
    );
  }

  if (!ev.storage_path) {
    return NextResponse.json(
      { error: "No file has been uploaded for this evidence item." },
      { status: 404 }
    );
  }

  // Generate a signed URL valid for 60 minutes
  const { data: signed, error: signErr } = await supabase.storage
    .from("dataq-evidence")
    .createSignedUrl(ev.storage_path as string, 3600);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Failed to generate signed URL: ${signErr?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
