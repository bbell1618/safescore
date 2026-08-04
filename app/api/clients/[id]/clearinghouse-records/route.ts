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

const recordSchema = z
  .object({
    driver_id: uuidSchema,
    query_date: isoDateSchema,
    result_type: z.enum(["negative", "positive"]),
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
          : "Unknown Clearinghouse record failure",
      code: "CLEARINGHOUSE_RECORD_FAILED",
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
    const parsed = recordSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid Clearinghouse query record.",
          code: "INVALID_CLEARINGHOUSE_RECORD",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const [clientResult, driverResult] = await Promise.all([
      service
        .from("clients")
        .select("id, tier")
        .eq("id", clientId.data)
        .maybeSingle(),
      service
        .from("drivers")
        .select("id, full_name")
        .eq("id", parsed.data.driver_id)
        .eq("client_id", clientId.data)
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(
        `Unable to verify the Clearinghouse client: ${clientResult.error.message}`
      );
    }
    if (driverResult.error) {
      throw new Error(
        `Unable to verify the Clearinghouse driver: ${driverResult.error.message}`
      );
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

    if (parsed.data.document_id) {
      const { data: document, error: documentError } = await service
        .from("documents")
        .select("id")
        .eq("id", parsed.data.document_id)
        .eq("client_id", clientId.data)
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

    const { data: record, error: insertError } = await service
      .from("clearinghouse_records")
      .insert({
        client_id: clientId.data,
        driver_id: parsed.data.driver_id,
        query_date: parsed.data.query_date,
        result_type: parsed.data.result_type,
        document_id: parsed.data.document_id ?? null,
      })
      .select(
        "id, client_id, driver_id, query_date, result_type, document_id, created_at"
      )
      .single();
    if (insertError || !record) {
      throw new Error(
        `Unable to record the Clearinghouse query: ${
          insertError?.message ?? "row not returned"
        }`
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: clientId.data,
      user_id: userId,
      action_type: "compliance_clearinghouse_query_recorded",
      entity_type: "clearinghouse_records",
      entity_id: record.id,
      description: `Clearinghouse query recorded for ${driverResult.data.full_name}`,
      metadata: {
        driver_id: parsed.data.driver_id,
        query_date: record.query_date,
        result_type: record.result_type,
        document_linked: Boolean(record.document_id),
        client_tier: clientResult.data.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Clearinghouse record ${record.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
