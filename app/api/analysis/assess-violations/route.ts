import { createServiceClient } from "@/lib/supabase/server";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
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

  const asOf = new Date();
  const results = violations.map((v) => {
    const insp = v.inspections as { inspection_date: string | null } | null;
    const tw = timeWeightFor(insp?.inspection_date ?? null, asOf);
    const sev = v.severity_weight as number | null;
    const points = sev != null && tw > 0 ? tw * (sev + (v.oos_violation ? 2 : 0)) : 0;
    const score = scoreChallenge({
      violationCode: v.violation_code,
      basicCategory: v.basic_category ?? null,
      severityWeight: sev,
      timeWeight: tw,
      challengeReason: null,
      oosViolation: !!v.oos_violation,
      convicted: v.convicted as boolean | null,
      citationNumber: v.citation_number as string | null,
      citationResult: v.citation_result as string | null,
      basicPercentile: null,
    });
    const priority =
      score.label === "strong" ? "high" : score.label === "moderate" ? "medium" : "low";
    return {
      violationId: v.id,
      challengeable: score.challengeable,
      label: score.label,
      overall: score.overall,
      factors: score.factors,
      summary: score.summary,
      priority,
      points,
    };
  });

  // Write results back to Supabase
  for (const result of results) {
    await supabase
      .from("violations")
      .update({
        challengeable: result.challengeable,
        challenge_reason: result.summary,
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
    description: `AI assessed ${results.length} violations - ${results.filter((r) => r.challengeable).length} flagged as challengeable`,
  });

  return NextResponse.json({ assessed: results.length, results });
}
