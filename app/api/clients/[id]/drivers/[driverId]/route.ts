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

const updateDriverSchema = z
  .object({
    full_name: z.string().trim().min(1).max(160).optional(),
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
    status: z.enum(["active", "inactive", "terminated"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

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
          : "Unknown driver update failure",
      code: "DRIVER_UPDATE_FAILED",
    },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; driverId: string }> }
) {
  try {
    const values = await params;
    const ids = z
      .object({ clientId: uuidSchema, driverId: uuidSchema })
      .safeParse({ clientId: values.id, driverId: values.driverId });
    if (!ids.success) {
      return NextResponse.json(
        { error: "Valid client and driver IDs are required.", code: "INVALID_IDS" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const parsed = updateDriverSchema.safeParse(await request.json());
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

    const [clientResult, driverResult] = await Promise.all([
      service
        .from("clients")
        .select("id, tier")
        .eq("id", ids.data.clientId)
        .maybeSingle(),
      service
        .from("drivers")
        .select("id, full_name")
        .eq("id", ids.data.driverId)
        .eq("client_id", ids.data.clientId)
        .not("approved_at", "is", null)
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(`Unable to verify the driver client: ${clientResult.error.message}`);
    }
    if (driverResult.error) {
      throw new Error(`Unable to verify the driver: ${driverResult.error.message}`);
    }
    if (!clientResult.data) {
      return NextResponse.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (!driverResult.data) {
      return NextResponse.json(
        { error: "Driver not found for this client", code: "DRIVER_NOT_FOUND" },
        { status: 404 }
      );
    }

    const changedFields = Object.keys(parsed.data);
    const { data: driver, error: updateError } = await service
      .from("drivers")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", ids.data.driverId)
      .eq("client_id", ids.data.clientId)
      .not("approved_at", "is", null)
      .select(
        "id, client_id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, status, source, approved_at, approved_by, request_id, notes, created_at, updated_at"
      )
      .single();
    if (updateError || !driver) {
      throw new Error(
        `Unable to update the driver: ${updateError?.message ?? "row not returned"}`
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_driver_updated",
      entity_type: "drivers",
      entity_id: driver.id,
      description: `Compliance driver updated: ${driver.full_name}`,
      metadata: {
        changed_fields: changedFields,
        client_tier: clientResult.data.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Driver ${driver.id} was updated, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ driver });
  } catch (error) {
    return failure(error);
  }
}
