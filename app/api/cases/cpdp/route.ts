import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().uuid(),
  crashId: z.string(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, crashId } = parsed.data;
  const supabase = await createServiceClient();

  // Check if a CPDP case already exists for this crash
  const { data: existing } = await supabase
    .from("cpdp_cases")
    .select("id")
    .eq("crash_id", crashId)
    .eq("client_id", clientId)
    .single();

  if (existing) {
    return NextResponse.json({ caseId: existing.id, existing: true });
  }

  // Insert new CPDP case
  const { data: newCase, error } = await supabase
    .from("cpdp_cases")
    .insert({
      client_id: clientId,
      crash_id: crashId,
      status: "pending_review",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("activity_log").insert({
    client_id: clientId,
    action_type: "case_created",
    entity_type: "cpdp_cases",
    entity_id: newCase.id,
    description: `CPDP case created for crash ${crashId}`,
  });

  return NextResponse.json({ caseId: newCase.id });
}
