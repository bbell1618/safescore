import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";
import { assembleClientWorkContext } from "@/lib/operator/checklist-server";
import { evaluateChecklist } from "@/lib/operator/checklist-rules";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const ackSchema = z
  .object({
    ruleKey: z.string().trim().min(1).max(160),
    contextKey: z.string().trim().min(1).max(300),
    action: z.enum(["done", "snooze"]),
    snoozedUntil: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

function failure(error: unknown) {
  if (error instanceof OnboardingRouteFailure) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Unknown checklist acknowledgement failure",
      code: "CHECKLIST_ACK_FAILED",
    },
    { status: 500 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedClientId = uuidSchema.safeParse((await params).id);
    if (!parsedClientId.success) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }
    const parsed = ackSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid checklist acknowledgement.",
          code: "INVALID_CHECKLIST_ACK",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const now = new Date();
    const context = await assembleClientWorkContext(parsedClientId.data, {
      service,
      now: now.toISOString(),
    });
    const currentItem = evaluateChecklist(context).find(
      (item) =>
        item.ruleKey === parsed.data.ruleKey &&
        item.contextKey === parsed.data.contextKey
    );
    if (!currentItem) {
      return NextResponse.json(
        {
          error:
            "This checklist item is no longer active or is already suppressed. Reload the checklist.",
          code: "CHECKLIST_ITEM_NOT_ACTIVE",
        },
        { status: 409 }
      );
    }
    if (parsed.data.action === "done" && !currentItem.canMarkDone) {
      return NextResponse.json(
        {
          error: "This derived item clears only when its source condition changes.",
          code: "CHECKLIST_DONE_NOT_ALLOWED",
        },
        { status: 409 }
      );
    }
    if (parsed.data.action === "snooze" && !currentItem.canSnooze) {
      return NextResponse.json(
        {
          error: "This checklist item cannot be snoozed.",
          code: "CHECKLIST_SNOOZE_NOT_ALLOWED",
        },
        { status: 409 }
      );
    }

    let snoozedUntil: string | null = null;
    if (parsed.data.action === "snooze") {
      const requested = parsed.data.snoozedUntil
        ? new Date(parsed.data.snoozedUntil)
        : new Date(
            now.getTime() +
              (currentItem.defaultSnoozeDays ?? 14) * 24 * 60 * 60 * 1_000
          );
      if (!Number.isFinite(requested.getTime()) || requested <= now) {
        return NextResponse.json(
          {
            error: "A snooze must end in the future.",
            code: "INVALID_SNOOZE_END",
          },
          { status: 400 }
        );
      }
      snoozedUntil = requested.toISOString();
    }

    const { data: acknowledgement, error: insertError } = await service
      .from("operator_item_acks")
      .insert({
        client_id: parsedClientId.data,
        rule_key: currentItem.ruleKey,
        context_key: currentItem.contextKey,
        action: parsed.data.action,
        snoozed_until: snoozedUntil,
        note: parsed.data.note || null,
        created_by: userId,
      })
      .select(
        "id, client_id, rule_key, context_key, action, snoozed_until, note, created_by, created_at"
      )
      .single();
    if (insertError?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "This checklist occurrence was already marked done in another session. Reload the checklist.",
          code: "CHECKLIST_ACKNOWLEDGEMENT_CONFLICT",
        },
        { status: 409 }
      );
    }
    if (insertError || !acknowledgement) {
      throw new Error(
        `Unable to save checklist acknowledgement: ${insertError?.message ?? "row not returned"}`
      );
    }

    return NextResponse.json({ acknowledgement }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
