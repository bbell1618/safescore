import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureCitationDispositionFollowup } from "@/lib/evidence-loop/server";
import { getPortalApiAccess } from "@/lib/portal/access";
import { createServiceClient } from "@/lib/supabase/server";
import { laneBIntakeAnswerOutcome } from "@/lib/evidence-loop/lifecycle";

export const dynamic = "force-dynamic";

const answerSchema = z.object({ answer: z.enum(["yes", "no"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  const access = await getPortalApiAccess("evidence_requests");
  if (access.status === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access.status !== "linked") {
    return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  }
  if (!access.allowed) {
    return NextResponse.json(
      { error: "Evidence requests are not included in this plan" },
      { status: 403 }
    );
  }

  const parsed = answerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Answer must be yes or no" },
      { status: 400 }
    );
  }

  const service = await createServiceClient();
  const { data: queueItem, error: queueError } = await service
    .from("client_requests")
    .select("id, client_id, request_type, evidence_class, evidence_status, status, response")
    .eq("id", requestId)
    .eq("client_id", access.clientId)
    .eq("responsibility", "client")
    .maybeSingle();
  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }
  if (
    !queueItem ||
    queueItem.request_type !== "question" ||
    queueItem.evidence_class !== "citation-dismissed"
  ) {
    return NextResponse.json({ error: "Intake question not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const outcome = laneBIntakeAnswerOutcome(parsed.data.answer);
  const existingAnswer =
    queueItem.response &&
    typeof queueItem.response === "object" &&
    "answer" in queueItem.response &&
    (queueItem.response.answer === "yes" || queueItem.response.answer === "no")
      ? queueItem.response.answer
      : null;
  if (existingAnswer && existingAnswer !== parsed.data.answer) {
    return NextResponse.json(
      { error: `This question was already answered ${existingAnswer}` },
      { status: 409 }
    );
  }

  if (!existingAnswer) {
    const { data: claimed, error: claimError } = await service
      .from("client_requests")
      .update({
        response: { answer: parsed.data.answer, answeredAt: now, source: "portal" },
        status_copy: "Answer recorded — finishing the follow-up.",
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("status", "open")
      .eq("evidence_status", "open")
      .is("response", null)
      .select("id")
      .maybeSingle();
    if (claimError) {
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }
    if (!claimed) {
      const { data: concurrent, error: concurrentError } = await service
        .from("client_requests")
        .select("response")
        .eq("id", requestId)
        .eq("client_id", access.clientId)
        .single();
      const concurrentAnswer =
        concurrent?.response &&
        typeof concurrent.response === "object" &&
        "answer" in concurrent.response
          ? concurrent.response.answer
          : null;
      if (concurrentError || concurrentAnswer !== parsed.data.answer) {
        return NextResponse.json(
          {
            error:
              concurrentError?.message ??
              "The intake question was answered differently in another request",
          },
          { status: concurrentError ? 500 : 409 }
        );
      }
    }
  }

  const { data: updatedClient, error: clientUpdateError } = await service
    .from("clients")
    .update({ citation_dismissed_last_24_months: outcome.clientValue })
    .eq("id", access.clientId)
    .select("id")
    .maybeSingle();
  if (clientUpdateError || !updatedClient) {
    return NextResponse.json(
      { error: clientUpdateError?.message ?? "Client answer state was not updated" },
      { status: 500 }
    );
  }

  let followupRequestId: string | undefined;
  if (outcome.needsFollowup) {
    try {
      const followup = await ensureCitationDispositionFollowup(service, {
        clientId: access.clientId,
        trigger: "intake_answer",
        sourceRequestId: requestId,
      });
      if (!followup.requestId) {
        throw new Error("Court-disposition follow-up was not created");
      }
      followupRequestId = followup.requestId;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to create the court-disposition request",
        },
        { status: 500 }
      );
    }
  }

  const { data: existingActivity, error: existingActivityError } = await service
    .from("activity_log")
    .select("id")
    .eq("action_type", "lane_b_intake_answered")
    .eq("entity_type", "client_requests")
    .eq("entity_id", requestId)
    .limit(1)
    .maybeSingle();
  if (existingActivityError) {
    return NextResponse.json({ error: existingActivityError.message }, { status: 500 });
  }
  const activityResult = existingActivity
    ? { data: existingActivity, error: null }
    : await service
        .from("activity_log")
        .insert({
          client_id: access.clientId,
          user_id: access.userId,
          action_type: "lane_b_intake_answered",
          entity_type: "client_requests",
          entity_id: requestId,
          description: "Client answered the citation-disposition intake question",
          metadata: {
            answer: parsed.data.answer,
            followup_request_id: followupRequestId ?? null,
          },
        })
        .select("id")
        .maybeSingle();
  if (activityResult.error || !activityResult.data) {
    return NextResponse.json(
      {
        error: `The answer was saved, but activity logging failed: ${
          activityResult.error?.message ?? "row not inserted"
        }`,
      },
      { status: 500 }
    );
  }

  const { data: finalizedRequest, error: requestUpdateError } = await service
    .from("client_requests")
    .update({
      evidence_status: "applied",
      status: "fulfilled",
      status_copy: outcome.statusCopy,
      submitted_at: now,
      applied_at: now,
      closed_at: now,
      next_reminder_at: null,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("client_id", access.clientId)
    .select("id")
    .maybeSingle();
  if (requestUpdateError || !finalizedRequest) {
    return NextResponse.json(
      {
        error:
          requestUpdateError?.message ??
          "The intake answer was saved, but its final status was not updated",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ...(followupRequestId ? { followupRequestId } : {}),
  });
}
