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

const dqfItemSchema = z
  .object({
    doc_type: z.enum([
      "cdl",
      "medical_cert",
      "mvr",
      "application",
      "road_test",
      "training",
      "prior_employer_checks",
      "annual_mvr_review",
      "clearinghouse_pre_employment",
    ]),
    status: z.enum(["current", "expiring_soon", "expired", "missing"]),
    document_id: z.union([uuidSchema, z.null()]).optional(),
    completed_date: z.union([isoDateSchema, z.null()]).optional(),
    expiry_date: z.union([isoDateSchema, z.null()]).optional(),
    notes: z.union([z.string().trim().min(1).max(2_000), z.null()]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "missing") return;

    if (
      (value.doc_type === "medical_cert" || value.doc_type === "cdl") &&
      !value.expiry_date
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiry_date"],
        message: "An expiration date is required when this credential is on file.",
      });
    }

    if (
      value.doc_type === "annual_mvr_review" &&
      !value.completed_date &&
      !value.expiry_date
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completed_date"],
        message:
          "A completed date or next-review date is required for an annual MVR review.",
      });
    }

    if (
      [
        "application",
        "prior_employer_checks",
        "road_test",
        "mvr",
        "clearinghouse_pre_employment",
      ].includes(value.doc_type) &&
      !value.completed_date
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completed_date"],
        message: "A completed date is required when this record is on file.",
      });
    }
  });

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
        error instanceof Error ? error.message : "Unknown DQF update failure",
      code: "DQF_UPDATE_FAILED",
    },
    { status: 500 }
  );
}

export async function PUT(
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
    const parsed = dqfItemSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid qualification-file item.",
          code: "INVALID_DQF_ITEM",
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
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(`Unable to verify the DQF client: ${clientResult.error.message}`);
    }
    if (driverResult.error) {
      throw new Error(`Unable to verify the DQF driver: ${driverResult.error.message}`);
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
    const { data: item, error: upsertError } = await service
      .from("driver_documents")
      .upsert(
        {
          client_id: ids.data.clientId,
          driver_id: ids.data.driverId,
          doc_type: parsed.data.doc_type,
          status: parsed.data.status,
          document_id: parsed.data.document_id ?? null,
          completed_date: parsed.data.completed_date ?? null,
          expiry_date: parsed.data.expiry_date ?? null,
          notes: parsed.data.notes ?? null,
          updated_at: now,
        },
        { onConflict: "driver_id,doc_type" }
      )
      .select(
        "id, driver_id, client_id, document_id, doc_type, completed_date, expiry_date, status, notes, created_at, updated_at"
      )
      .single();
    if (upsertError || !item) {
      throw new Error(
        `Unable to save the qualification-file item: ${
          upsertError?.message ?? "row not returned"
        }`
      );
    }

    const driverExpiryColumn =
      item.doc_type === "medical_cert"
        ? "medical_cert_expiry"
        : item.doc_type === "cdl"
          ? "cdl_expiry"
          : null;
    const driverExpirationSynchronized = Boolean(
      driverExpiryColumn &&
      item.status !== "missing" &&
      item.expiry_date !== null
    );
    if (driverExpirationSynchronized && driverExpiryColumn) {
      const { error: driverExpiryError } = await service
        .from("drivers")
        .update({
          [driverExpiryColumn]: item.expiry_date,
          updated_at: now,
        })
        .eq("id", ids.data.driverId)
        .eq("client_id", ids.data.clientId);
      if (driverExpiryError) {
        throw new Error(
          `Qualification item ${item.id} was saved, but the driver expiration date could not be synchronized: ${driverExpiryError.message}`
        );
      }
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_dqf_item_updated",
      entity_type: "driver_documents",
      entity_id: item.id,
      description: `Driver qualification item updated for ${driverResult.data.full_name}`,
      metadata: {
        driver_id: ids.data.driverId,
        doc_type: item.doc_type,
        status: item.status,
        document_linked: Boolean(item.document_id),
        driver_expiration_synchronized: driverExpirationSynchronized,
        client_tier: clientResult.data.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Qualification item ${item.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ item });
  } catch (error) {
    return failure(error);
  }
}
