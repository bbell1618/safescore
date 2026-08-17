import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const patchSchema = z
  .object({
    status: z.enum(["open", "done"]).optional(),
    deleted: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => (value.status ? 1 : 0) + (value.deleted ? 1 : 0) === 1,
    "Provide exactly one manual-item action."
  );

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
          : "Unknown manual-item update failure",
      code: "MANUAL_ITEM_UPDATE_FAILED",
    },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const routeParams = await params;
    const parsedClientId = uuidSchema.safeParse(routeParams.id);
    const parsedItemId = uuidSchema.safeParse(routeParams.itemId);
    if (!parsedClientId.success || !parsedItemId.success) {
      return NextResponse.json(
        { error: "Valid client and item IDs are required.", code: "INVALID_ID" },
        { status: 400 }
      );
    }
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid manual-item update.",
          code: "INVALID_MANUAL_ITEM_UPDATE",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { service } = await requireStaffOnboardingUser();
    const now = new Date().toISOString();
    const update = parsed.data.deleted
      ? { deleted_at: now }
      : {
          status: parsed.data.status,
          completed_at: parsed.data.status === "done" ? now : null,
        };
    const { data: manualItem, error: updateError } = await service
      .from("operator_manual_items")
      .update(update)
      .eq("id", parsedItemId.data)
      .eq("client_id", parsedClientId.data)
      .is("deleted_at", null)
      .select(
        "id, client_id, title, details, due_date, status, created_by, created_at, completed_at, deleted_at"
      )
      .maybeSingle();
    if (updateError) {
      throw new Error(`Unable to update manual checklist item: ${updateError.message}`);
    }
    if (!manualItem) {
      return NextResponse.json(
        {
          error: "Manual checklist item not found or already removed.",
          code: "MANUAL_ITEM_NOT_FOUND",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ manualItem });
  } catch (error) {
    return failure(error);
  }
}
