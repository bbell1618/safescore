import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { narrativeBlockReason, SENTINEL_INSUFFICIENT } from "@/lib/analysis/narrative-sentinels";

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

  // Fetch the narrative to check for sentinel tokens
  const { data: c } = await supabase
    .from("dataq_cases")
    .select("final_narrative, ai_narrative")
    .eq("id", id)
    .single();

  const narrativeToCheck = c?.final_narrative ?? c?.ai_narrative ?? "";

  // Hard block: INSUFFICIENT EVIDENCE — the verification checkbox cannot override this
  if (narrativeToCheck.includes(SENTINEL_INSUFFICIENT)) {
    return NextResponse.json(
      {
        error:
          "The AI determined the evidence does not support this challenge. The verification checkbox does not override an INSUFFICIENT EVIDENCE verdict. Obtain proper evidence and regenerate.",
      },
      { status: 400 }
    );
  }

  // Soft block: unresolved [VERIFY: ...] placeholders
  const blockReason = narrativeBlockReason(narrativeToCheck);
  if (blockReason) {
    return NextResponse.json({ error: blockReason }, { status: 400 });
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
