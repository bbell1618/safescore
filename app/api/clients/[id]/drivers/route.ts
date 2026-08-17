import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

const uuidSchema = z.string().uuid();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Use a real calendar date.");
const nullableDate = z.union([isoDateSchema, z.null()]).optional();
const nullableText = (maximum: number) =>
  z.union([z.string().trim().min(1).max(maximum), z.null()]).optional();

const createDriverSchema = z
  .object({
    full_name: z.string().trim().min(1).max(160),
    cdl_number: nullableText(80),
    cdl_state: z
      .union([
        z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
        z.null(),
      ])
      .optional(),
    cdl_class: nullableText(20),
    cdl_expiry: nullableDate,
    medical_cert_expiry: nullableDate,
    hired_date: nullableDate,
    status: z.enum(["active", "inactive", "terminated"]).default("active"),
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
          : "Unknown driver creation failure",
      code: "DRIVER_CREATE_FAILED",
    },
    { status: 500 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clientId = uuidSchema.safeParse(id);
    if (!clientId.success) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const parsed = createDriverSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid driver details.",
          code: "INVALID_DRIVER",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { data: client, error: clientError } = await service
      .from("clients")
      .select("id, tier")
      .eq("id", clientId.data)
      .maybeSingle();
    if (clientError) {
      throw new Error(`Unable to verify the driver client: ${clientError.message}`);
    }
    if (!client) {
      return NextResponse.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const { data: driver, error: insertError } = await service
      .from("drivers")
      .insert({
        client_id: clientId.data,
        full_name: parsed.data.full_name,
        cdl_number: parsed.data.cdl_number ?? null,
        cdl_state: parsed.data.cdl_state ?? null,
        cdl_class: parsed.data.cdl_class ?? null,
        cdl_expiry: parsed.data.cdl_expiry ?? null,
        medical_cert_expiry: parsed.data.medical_cert_expiry ?? null,
        hired_date: parsed.data.hired_date ?? null,
        status: parsed.data.status,
        source: "operator",
        approved_at: now,
        approved_by: userId,
        request_id: null,
        updated_at: now,
      })
      .select(
        "id, client_id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, status, source, approved_at, approved_by, request_id, notes, created_at, updated_at"
      )
      .single();
    if (insertError || !driver) {
      throw new Error(
        `Unable to add the driver: ${insertError?.message ?? "row not returned"}`
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: clientId.data,
      user_id: userId,
      action_type: "compliance_driver_created",
      entity_type: "drivers",
      entity_id: driver.id,
      description: `Compliance driver added: ${driver.full_name}`,
      metadata: {
        status: driver.status,
        client_tier: client.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Driver ${driver.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ driver }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
