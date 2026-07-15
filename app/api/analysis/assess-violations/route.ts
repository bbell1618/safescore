import { createServiceClient } from "@/lib/supabase/server";
import { runChallengeabilityAssessment } from "@/lib/analysis/challengeability-assessment-server";
import { NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 300;

const schema = z.object({
  clientId: z.string().uuid(),
  violationIds: z.array(z.string().uuid()).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createServiceClient();
  try {
    const result = await runChallengeabilityAssessment(supabase, parsed.data.clientId, parsed.data);
    if (result.failures.length > 0) {
      return NextResponse.json({
        error: `Challengeability analysis assessed ${result.assessed} of ${result.requested}; ${result.failures.length} remain unassessed.`,
        ...result,
      }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Challengeability analysis failed",
    }, { status: 500 });
  }
}
