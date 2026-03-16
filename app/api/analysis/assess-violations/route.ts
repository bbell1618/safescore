import { createServiceClient } from "@/lib/supabase/server";
import { assessViolationsBatch } from "@/lib/analysis/challengeability";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  clientId: z.string().uuid(),
  violationIds: z.array(z.string().uuid()),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, violationIds } = parsed.data;
  const supabase = await createServiceClient();

  // Fetch violation details + inspection context
  const { data: violations } = await supabase
    .from("violations")
    .select("*, inspections(inspection_date, state, level)")
    .eq("client_id", clientId)
    .in("id", violationIds);

  if (!violations || violations.length === 0) {
    return NextResponse.json({ error: "No violations found" }, { status: 404 });
  }

  const inputs = violations.map((v) => ({
    id: v.id,
    violationCode: v.violation_code,
    description: v.violation_description,
    basicCategory: v.basic_category ?? "vehicle_maintenance",
    severityWeight: v.severity_weight ?? 1,
    oosViolation: v.oos_violation,
    convicted: v.convicted,
    inspectionDate: (v.inspections as { inspection_date: string } | null)?.inspection_date ?? "",
    state: (v.inspections as { state: string } | null)?.state ?? "",
    inspectionLevel: (v.inspections as { level: string } | null)?.level ?? "",
  }));

  const results = await assessViolationsBatch(inputs);

  // Write results back to Supabase
  for (const result of results) {
    await supabase
      .from("violations")
      .update({
        challengeable: result.challengeable,
        challenge_reason: result.reason,
        challenge_priority: result.priority,
        ai_assessed_at: new Date().toISOString(),
      })
      .eq("id", result.violationId);
  }

  // Log activity
  await supabase.from("activity_log").insert({
    client_id: clientId,
    action_type: "violation_assessed",
    entity_type: "violations",
    description: `AI assessed ${results.length} violations — ${results.filter((r) => r.challengeable).length} flagged as challengeable`,
  });

  return NextResponse.json({ assessed: results.length, results });
}
