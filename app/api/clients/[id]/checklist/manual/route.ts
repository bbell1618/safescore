import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, { message: "Use a real YYYY-MM-DD date." });
const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(2_000).optional(),
    dueDate: dateSchema.optional(),
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
          : "Unknown manual-item creation failure",
      code: "MANUAL_ITEM_CREATE_FAILED",
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
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid manual checklist item.",
          code: "INVALID_MANUAL_ITEM",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const { data: client, error: clientError } = await service
      .from("clients")
      .select("id")
      .eq("id", parsedClientId.data)
      .maybeSingle();
    if (clientError) {
      throw new Error(`Unable to verify manual-item client: ${clientError.message}`);
    }
    if (!client) {
      return NextResponse.json(
        { error: "Client not found.", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const { data: manualItem, error: insertError } = await service
      .from("operator_manual_items")
      .insert({
        client_id: parsedClientId.data,
        title: parsed.data.title,
        details: parsed.data.details || null,
        due_date: parsed.data.dueDate ?? null,
        created_by: userId,
      })
      .select(
        "id, client_id, title, details, due_date, status, created_by, created_at, completed_at, deleted_at"
      )
      .single();
    if (insertError || !manualItem) {
      throw new Error(
        `Unable to create manual checklist item: ${insertError?.message ?? "row not returned"}`
      );
    }
    return NextResponse.json({ manualItem }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
