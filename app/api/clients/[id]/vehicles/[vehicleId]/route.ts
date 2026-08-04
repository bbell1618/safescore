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
const nullableText = (maximum: number) =>
  z.union([z.string().trim().min(1).max(maximum), z.null()]).optional();

const updateVehicleSchema = z
  .object({
    unit_number: z.string().trim().min(1).max(80).optional(),
    vin: nullableText(80),
    year: z.union([z.number().int().min(1900).max(2100), z.null()]).optional(),
    make: nullableText(80),
    model: nullableText(80),
    license_plate: nullableText(40),
    plate_state: z
      .union([
        z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
        z.null(),
      ])
      .optional(),
    annual_inspection_date: z.union([isoDateSchema, z.null()]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
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
          : "Unknown vehicle update failure",
      code: "VEHICLE_UPDATE_FAILED",
    },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; vehicleId: string }> }
) {
  try {
    const values = await params;
    const ids = z
      .object({ clientId: uuidSchema, vehicleId: uuidSchema })
      .safeParse({ clientId: values.id, vehicleId: values.vehicleId });
    if (!ids.success) {
      return NextResponse.json(
        { error: "Valid client and vehicle IDs are required.", code: "INVALID_IDS" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const parsed = updateVehicleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid vehicle details.",
          code: "INVALID_VEHICLE",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const [clientResult, vehicleResult] = await Promise.all([
      service
        .from("clients")
        .select("id, tier")
        .eq("id", ids.data.clientId)
        .maybeSingle(),
      service
        .from("vehicles")
        .select("id, unit_number")
        .eq("id", ids.data.vehicleId)
        .eq("client_id", ids.data.clientId)
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(`Unable to verify the vehicle client: ${clientResult.error.message}`);
    }
    if (vehicleResult.error) {
      throw new Error(`Unable to verify the vehicle: ${vehicleResult.error.message}`);
    }
    if (!clientResult.data) {
      return NextResponse.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (!vehicleResult.data) {
      return NextResponse.json(
        { error: "Vehicle not found for this client", code: "VEHICLE_NOT_FOUND" },
        { status: 404 }
      );
    }

    const changedFields = Object.keys(parsed.data);
    const { data: vehicle, error: updateError } = await service
      .from("vehicles")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", ids.data.vehicleId)
      .eq("client_id", ids.data.clientId)
      .select(
        "id, client_id, unit_number, vin, year, make, model, license_plate, plate_state, annual_inspection_date, status, created_at, updated_at"
      )
      .single();
    if (updateError || !vehicle) {
      throw new Error(
        `Unable to update the vehicle: ${updateError?.message ?? "row not returned"}`
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_vehicle_updated",
      entity_type: "vehicles",
      entity_id: vehicle.id,
      description: `Compliance vehicle updated: unit ${vehicle.unit_number}`,
      metadata: {
        changed_fields: changedFields,
        client_tier: clientResult.data.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Vehicle ${vehicle.id} was updated, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ vehicle });
  } catch (error) {
    return failure(error);
  }
}
