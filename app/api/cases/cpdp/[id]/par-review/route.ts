import { NextResponse } from "next/server";
import { z } from "zod";
import { narrativeBlockReason } from "@/lib/analysis/narrative-sentinels";
import {
  CPDP_ELIGIBILITY_QUESTIONS,
  eligibleTypesFromQuestions,
  type ParAiAssessment,
} from "@/lib/cpdp/par-assessment-types";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  identityConfirmed: z.literal(true),
  identityOverrideReason: z.string().trim().max(1000).nullable().optional(),
  questions: z.array(z.object({
    id: z.enum(CPDP_ELIGIBILITY_QUESTIONS.map((question) => question.id)),
    answer: z.enum(["YES", "NO", "UNCLEAR"]),
    overrideReason: z.string().trim().max(1000).nullable().optional(),
    supportingExcerpt: z.string().trim().max(2000).nullable().optional(),
  })).length(CPDP_ELIGIBILITY_QUESTIONS.length),
  finalNarrative: z.string().trim().max(12000).nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const staff = await service.from("users").select("role").eq("id", user.id).single();
  if (staff.error) {
    return NextResponse.json({ error: `Unable to verify staff access: ${staff.error.message}` }, { status: 500 });
  }
  if (!staff.data || !["geia_admin", "geia_staff"].includes(staff.data.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid PAR review", details: parsed.error.flatten() }, { status: 400 });
  }
  if (new Set(parsed.data.questions.map((question) => question.id)).size !== CPDP_ELIGIBILITY_QUESTIONS.length) {
    return NextResponse.json({ error: "PAR review must include each official CPDP question exactly once." }, { status: 400 });
  }

  const caseResult = await service
    .from("cpdp_cases")
    .select("par_ai_assessment, par_assessment_status")
    .eq("id", id)
    .single();
  if (caseResult.error || !caseResult.data) {
    return NextResponse.json({ error: caseResult.error?.message ?? "CPDP case not found" }, { status: 404 });
  }
  if (caseResult.data.par_assessment_status !== "ready_for_review" || !caseResult.data.par_ai_assessment) {
    return NextResponse.json({ error: "A completed PAR assessment is required before approval." }, { status: 409 });
  }
  const aiAssessment = caseResult.data.par_ai_assessment as ParAiAssessment;
  const aiById = new Map(aiAssessment.questions.map((question) => [question.id, question]));
  const submittedById = new Map(parsed.data.questions.map((question) => [question.id, question]));
  for (const definition of CPDP_ELIGIBILITY_QUESTIONS) {
    const ai = aiById.get(definition.id);
    const submitted = submittedById.get(definition.id);
    if (!ai || !submitted) {
      return NextResponse.json({ error: `Assessment is missing question ${definition.id}` }, { status: 409 });
    }
    if (submitted.answer !== ai.answer && !submitted.overrideReason) {
      return NextResponse.json({ error: `An override reason is required for ${definition.label}` }, { status: 400 });
    }
    if (
      submitted.answer === "YES" &&
      submitted.answer !== ai.answer &&
      !submitted.supportingExcerpt
    ) {
      return NextResponse.json(
        { error: `A quoted PAR excerpt is required to override ${definition.label} to YES.` },
        { status: 400 }
      );
    }
  }
  const overrides: Array<Record<string, string>> = [];
  const reviewedQuestions = CPDP_ELIGIBILITY_QUESTIONS.map((definition) => {
    const ai = aiById.get(definition.id);
    const submitted = submittedById.get(definition.id);
    if (!ai || !submitted) throw new Error(`Assessment is missing question ${definition.id}`);
    if (submitted.answer !== ai.answer) {
      overrides.push({
        question_id: definition.id,
        from: ai.answer,
        to: submitted.answer,
        reason: submitted.overrideReason ?? "",
        supporting_excerpt: submitted.supportingExcerpt ?? "",
      });
    }
    const reviewed = {
      ...ai,
      answer: submitted.answer,
      excerpt:
        submitted.answer === "YES" && submitted.answer !== ai.answer
          ? submitted.supportingExcerpt ?? null
          : ai.excerpt,
      overrideReason: submitted.answer !== ai.answer ? submitted.overrideReason : null,
    };
    if (reviewed.answer === "YES" && !reviewed.excerpt?.trim()) {
      throw new Error(`Approved YES answer is missing a PAR excerpt for ${definition.label}`);
    }
    return reviewed;
  });

  if (aiAssessment.identity.overall !== "MATCH") {
    if (!parsed.data.identityOverrideReason) {
      return NextResponse.json(
        { error: "An identity override reason is required because the AI did not match this PAR to the crash." },
        { status: 400 }
      );
    }
    overrides.push({
      question_id: "par_identity",
      from: aiAssessment.identity.overall,
      to: "MATCH",
      reason: parsed.data.identityOverrideReason,
    });
  }

  const eligibleTypes = eligibleTypesFromQuestions(reviewedQuestions);
  const narrative = parsed.data.finalNarrative?.trim() || null;
  if (eligibleTypes.length > 0 && (!narrative || narrative.length < 80)) {
    return NextResponse.json({ error: "A grounded RFD narrative of at least 80 characters is required for an eligible review." }, { status: 400 });
  }
  if (narrative) {
    const block = narrativeBlockReason(narrative);
    if (block || /\[[^\]\n]{1,80}\]/.test(narrative)) {
      return NextResponse.json({ error: block ?? "Narrative contains a bracketed placeholder." }, { status: 400 });
    }
  }

  const reviewAssessment = {
    ...aiAssessment,
    identity: {
      ...aiAssessment.identity,
      confirmed: true,
      overrideReason: aiAssessment.identity.overall === "MATCH"
        ? null
        : parsed.data.identityOverrideReason,
    },
    questions: reviewedQuestions,
    verdict: eligibleTypes.length > 0
      ? "ELIGIBLE"
      : reviewedQuestions.some((question) => question.answer === "UNCLEAR")
        ? "INDETERMINATE"
        : "NOT_ELIGIBLE",
    draftedNarrative: narrative,
    reviewedAt: new Date().toISOString(),
  };
  const rpc = await service.rpc("approve_cpdp_par_assessment_v1", {
    p_case_id: id,
    p_reviewer_id: user.id,
    p_review_assessment: reviewAssessment,
    p_eligible_types: eligibleTypes,
    p_final_narrative: narrative,
    p_overrides: overrides,
  });
  if (rpc.error) {
    return NextResponse.json({ error: `Unable to approve PAR assessment: ${rpc.error.message}` }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    eligibleTypes,
    overrides,
    review: Array.isArray(rpc.data) ? rpc.data[0] : rpc.data,
  });
}
