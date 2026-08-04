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

const maintenanceSchema = z
  .object({
    maintenance_type: z.enum(["pm_service", "repair", "annual_inspection"]),
    completed_date: isoDateSchema,
    scheduled_date: z.union([isoDateSchema, z.null()]).optional(),
    notes: z.union([z.string().trim().min(1).max(4_000), z.null()]).optional(),
    document_id: z.union([uuidSchema, z.null()]).optional(),
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
          : "Unknown maintenance-entry failure",
      code: "MAINTENANCE_CREATE_FAILED",
    },
    { status: 500 }
  );
}

export async function POST(
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
    const parsed = maintenanceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid maintenance entry.",
          code: "INVALID_MAINTENANCE_ENTRY",
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
        .select("id, unit_number, annual_inspection_date")
        .eq("id", ids.data.vehicleId)
        .eq("client_id", ids.data.clientId)
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(`Unable to verify the maintenance client: ${clientResult.error.message}`);
    }
    if (vehicleResult.error) {
      throw new Error(`Unable to verify the maintenance vehicle: ${vehicleResult.error.message}`);
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

    if (parsed.data.document_id) {
      const { data: document, error: documentError } = await service
        .from("documents")
        .select("id")
        .eq("id", parsed.data.document_id)
        .eq("client_id", ids.data.clientId)
        .maybeSingle();
      if (documentError) {
        throw new Error(`Unable to verify the linked document: ${documentError.message}`);
      }
      if (!document) {
        return NextResponse.json(
          {
            error: "Document not found for this client",
            code: "DOCUMENT_NOT_FOUND",
          },
          { status: 404 }
        );
      }
    }

    const now = new Date().toISOString();
    const { data: entry, error: insertError } = await service
      .from("vehicle_maintenance")
      .insert({
        client_id: ids.data.clientId,
        vehicle_id: ids.data.vehicleId,
        maintenance_type: parsed.data.maintenance_type,
        completed_date: parsed.data.completed_date,
        scheduled_date: parsed.data.scheduled_date ?? null,
        notes: parsed.data.notes ?? null,
        document_id: parsed.data.document_id ?? null,
        updated_at: now,
      })
      .select(
        "id, vehicle_id, client_id, maintenance_type, scheduled_date, completed_date, notes, document_id, created_at, updated_at"
      )
      .single();
    if (insertError || !entry) {
      throw new Error(
        `Unable to add the maintenance entry: ${insertError?.message ?? "row not returned"}`
      );
    }

    let annualInspectionSynced = false;
    if (
      entry.maintenance_type === "annual_inspection" &&
      (!vehicleResult.data.annual_inspection_date ||
        entry.completed_date > vehicleResult.data.annual_inspection_date)
    ) {
      const { error: vehicleUpdateError } = await service
        .from("vehicles")
        .update({
          annual_inspection_date: entry.completed_date,
          updated_at: now,
        })
        .eq("id", ids.data.vehicleId)
        .eq("client_id", ids.data.clientId);
      if (vehicleUpdateError) {
        throw new Error(
          `Maintenance entry ${entry.id} was saved, but the annual inspection date could not be synchronized: ${vehicleUpdateError.message}`
        );
      }
      annualInspectionSynced = true;
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_vehicle_maintenance_recorded",
      entity_type: "vehicle_maintenance",
      entity_id: entry.id,
      description: `Maintenance recorded for unit ${vehicleResult.data.unit_number}`,
      metadata: {
        vehicle_id: ids.data.vehicleId,
        maintenance_type: entry.maintenance_type,
        completed_date: entry.completed_date,
        document_linked: Boolean(entry.document_id),
        annual_inspection_synced: annualInspectionSynced,
        client_tier: clientResult.data.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Maintenance entry ${entry.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ entry, annualInspectionSynced }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
