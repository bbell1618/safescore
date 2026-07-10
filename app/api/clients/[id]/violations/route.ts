import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/clients/[id]/violations
 * Query params:
 *   challengeable=true  — return only violations where challengeable = true
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const challengeableOnly = url.searchParams.get("challengeable") === "true";

  const supabase = getAdmin();
  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(id, supabase);

  let query = supabase
    .from("violations")
    .select(
      "id, violation_code, violation_description, challenge_priority, inspection_id"
    )
    .eq("client_id", id)
    .order("challenge_priority", { ascending: true });

  if (challengeableOnly) {
    query = query.eq("challengeable", true);
  }

  query = canonicalInspectionIds.length > 0
    ? query.in("inspection_id", canonicalInspectionIds)
    : query.in("inspection_id", []);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ violations: data ?? [] });
}
