import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  clientId: z.string().uuid(),
  violationId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, violationId } = parsed.data;
  const supabase = await createServiceClient();

  // Check existing case for this violation
  const { data: existing } = await supabase
    .from("dataq_cases")
    .select("id")
    .eq("violation_id", violationId)
    .single();

  if (existing) {
    return NextResponse.json({ caseId: existing.id, existing: true });
  }

  // Get violation details for priority
  const { data: violation } = await supabase
    .from("violations")
    .select("inspection_id, challenge_priority")
    .eq("id", violationId)
    .single();

  const { data: newCase, error } = await supabase
    .from("dataq_cases")
    .insert({
      client_id: clientId,
      violation_id: violationId,
      inspection_id: violation?.inspection_id ?? null,
      status: "draft",
      priority: violation?.challenge_priority ?? "medium",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("activity_log").insert({
    client_id: clientId,
    action_type: "case_created",
    entity_type: "dataq_cases",
    entity_id: newCase.id,
    description: `DataQs case created for violation ${violationId}`,
  });

  return NextResponse.json({ caseId: newCase.id });
}
