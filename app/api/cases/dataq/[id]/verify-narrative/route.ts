import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  // Fetch the narrative to check for unresolved placeholders
  const { data: c } = await supabase
    .from("dataq_cases")
    .select("final_narrative, ai_narrative")
    .eq("id", id)
    .single();

  const narrativeToCheck = c?.final_narrative ?? c?.ai_narrative ?? "";
  if (narrativeToCheck.includes("[VERIFY:")) {
    return NextResponse.json(
      {
        error:
          "Narrative contains unresolved [VERIFY: ...] placeholders. Resolve them before approving.",
      },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("dataq_cases")
    .update({
      narrative_evidence_verified: true,
      narrative_verified_at: new Date().toISOString(),
      narrative_verified_by: "staff",
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
