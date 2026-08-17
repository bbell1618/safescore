import { NextResponse } from "next/server";
import { z } from "zod";
import { complianceDocumentExpiryStatus } from "@/lib/compliance/health";
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

const pendingDriverUpdatesSchema = z
  .object({
    full_name: z.string().trim().min(1).max(160).optional(),
    cdl_number: nullableText(80),
    cdl_state: z
      .union([
        z
          .string()
          .trim()
          .length(2)
          .regex(/^[A-Za-z]{2}$/)
          .transform((value) => value.toUpperCase()),
        z.null(),
      ])
      .optional(),
    cdl_class: nullableText(20),
    cdl_expiry: nullableDate,
    medical_cert_expiry: nullableDate,
    hired_date: nullableDate,
    status: z.enum(["active", "inactive", "terminated"]).optional(),
  })
  .strict();

const approveSchema = z
  .object({
    action: z.literal("approve"),
    updates: pendingDriverUpdatesSchema.optional(),
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
          : "Unknown driver review failure",
      code: "DRIVER_REVIEW_FAILED",
    },
    { status: 500 }
  );
}

function parseIds(values: { id: string; driverId: string }) {
  return z
    .object({ clientId: uuidSchema, driverId: uuidSchema })
    .safeParse({ clientId: values.id, driverId: values.driverId });
}

function pacificDateOnly(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; driverId: string }> }
) {
  try {
    const ids = parseIds(await params);
    if (!ids.success) {
      return NextResponse.json(
        { error: "Valid client and driver IDs are required.", code: "INVALID_IDS" },
        { status: 400 }
      );
    }

    const parsed = approveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid driver review details.",
          code: "INVALID_DRIVER_REVIEW",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const { data: pendingDriver, error: pendingDriverError } = await service
      .from("drivers")
      .select(
        "id, client_id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, status, source, approved_at, approved_by, request_id, notes, created_at, updated_at"
      )
      .eq("id", ids.data.driverId)
      .eq("client_id", ids.data.clientId)
      .eq("source", "client_portal")
      .is("approved_at", null)
      .maybeSingle();
    if (pendingDriverError) {
      throw new Error(
        `Unable to load the pending driver: ${pendingDriverError.message}`
      );
    }
    if (!pendingDriver) {
      return NextResponse.json(
        {
          error: "Pending client-submitted driver not found for this client.",
          code: "PENDING_DRIVER_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    const finalDriver = {
      ...pendingDriver,
      ...(parsed.data.updates ?? {}),
    };
    const { data: stagedDriverDocuments, error: stagedDocumentsError } =
      await service
        .from("driver_documents")
        .select("id, document_id, doc_type")
        .eq("client_id", ids.data.clientId)
        .eq("driver_id", pendingDriver.id)
        .in("doc_type", ["cdl", "medical_cert"]);
    if (stagedDocumentsError) {
      throw new Error(
        `Unable to load the pending driver's credential documents: ${stagedDocumentsError.message}`
      );
    }

    const asOfDate = pacificDateOnly(nowDate);
    for (const item of stagedDriverDocuments ?? []) {
      const expiryDate =
        item.doc_type === "cdl"
          ? finalDriver.cdl_expiry
          : finalDriver.medical_cert_expiry;
      const { data: updatedItem, error: itemError } = await service
        .from("driver_documents")
        .update({
          expiry_date: expiryDate,
          status: complianceDocumentExpiryStatus(expiryDate, asOfDate),
          updated_at: now,
        })
        .eq("id", item.id)
        .eq("client_id", ids.data.clientId)
        .eq("driver_id", pendingDriver.id)
        .eq("doc_type", item.doc_type)
        .select("id")
        .maybeSingle();
      if (itemError || !updatedItem) {
        throw new Error(
          `Unable to finalize the ${item.doc_type} record before approving the driver: ${
            itemError?.message ?? "row changed during review"
          }`
        );
      }
    }

    const stagedDocumentIds = [
      ...new Set(
        (stagedDriverDocuments ?? [])
          .map((item) => item.document_id)
          .filter((id): id is string => id !== null)
      ),
    ];
    if (stagedDocumentIds.length > 0) {
      if (!pendingDriver.request_id) {
        throw new Error(
          "The pending driver's documents are not linked to a roster request; the driver remains pending."
        );
      }
      const { data: reviewedDocuments, error: documentsReviewError } =
        await service
          .from("documents")
          .update({ status: "reviewed" })
          .eq("client_id", ids.data.clientId)
          .eq("client_request_id", pendingDriver.request_id)
          .in("id", stagedDocumentIds)
          .select("id");
      if (documentsReviewError) {
        throw new Error(
          `Unable to mark the staged documents reviewed; the driver remains pending: ${documentsReviewError.message}`
        );
      }
      if ((reviewedDocuments ?? []).length !== stagedDocumentIds.length) {
        throw new Error(
          `Only ${reviewedDocuments?.length ?? 0} of ${stagedDocumentIds.length} staged documents matched the driver request; the driver remains pending.`
        );
      }
    }

    // Child records are finalized first. If one fails, approved_at remains null,
    // so no downstream compliance consumer can observe a partially approved row.
    const { data: driver, error: updateError } = await service
      .from("drivers")
      .update({
        ...(parsed.data.updates ?? {}),
        approved_at: now,
        approved_by: userId,
        updated_at: now,
      })
      .eq("id", ids.data.driverId)
      .eq("client_id", ids.data.clientId)
      .eq("source", "client_portal")
      .is("approved_at", null)
      .select(
        "id, client_id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, status, source, approved_at, approved_by, request_id, notes, created_at, updated_at"
      )
      .maybeSingle();
    if (updateError) {
      throw new Error(`Unable to approve the driver: ${updateError.message}`);
    }
    if (!driver) {
      return NextResponse.json(
        {
          error: "Pending client-submitted driver not found for this client.",
          code: "PENDING_DRIVER_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_driver_approved",
      entity_type: "drivers",
      entity_id: driver.id,
      description: `Client-submitted driver approved: ${driver.full_name}`,
      metadata: {
        request_id: driver.request_id,
        changed_fields: Object.keys(parsed.data.updates ?? {}),
        driver_document_ids: (stagedDriverDocuments ?? []).map(
          (item) => item.id
        ),
        reviewed_document_ids: stagedDocumentIds,
      },
    });
    if (activityError) {
      throw new Error(
        `Driver ${driver.id} was approved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ driver });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; driverId: string }> }
) {
  try {
    const ids = parseIds(await params);
    if (!ids.success) {
      return NextResponse.json(
        { error: "Valid client and driver IDs are required.", code: "INVALID_IDS" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const { data: driver, error: driverError } = await service
      .from("drivers")
      .select("id, full_name, request_id")
      .eq("id", ids.data.driverId)
      .eq("client_id", ids.data.clientId)
      .eq("source", "client_portal")
      .is("approved_at", null)
      .maybeSingle();
    if (driverError) {
      throw new Error(`Unable to load the pending driver: ${driverError.message}`);
    }
    if (!driver) {
      return NextResponse.json(
        {
          error: "Pending client-submitted driver not found for this client.",
          code: "PENDING_DRIVER_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    const { data: links, error: linksError } = await service
      .from("driver_documents")
      .select("document_id")
      .eq("client_id", ids.data.clientId)
      .eq("driver_id", driver.id)
      .not("document_id", "is", null);
    if (linksError) {
      throw new Error(
        `Unable to load the pending driver's documents: ${linksError.message}`
      );
    }
    const linkedDocumentIds = [
      ...new Set(
        (links ?? [])
          .map((link) => link.document_id)
          .filter((id): id is string => id !== null)
      ),
    ];

    let cleanupDocuments: Array<{ id: string; storage_path: string }> = [];
    if (driver.request_id && linkedDocumentIds.length > 0) {
      const [{ data: documents, error: documentsError }, { data: otherLinks, error: otherLinksError }] =
        await Promise.all([
          service
            .from("documents")
            .select("id, storage_path")
            .eq("client_id", ids.data.clientId)
            .eq("client_request_id", driver.request_id)
            .in("id", linkedDocumentIds),
          service
            .from("driver_documents")
            .select("document_id")
            .eq("client_id", ids.data.clientId)
            .in("document_id", linkedDocumentIds)
            .neq("driver_id", driver.id),
        ]);
      if (documentsError || otherLinksError) {
        throw new Error(
          `Unable to verify staged document cleanup: ${
            documentsError?.message ?? otherLinksError?.message
          }`
        );
      }
      const sharedIds = new Set(
        (otherLinks ?? [])
          .map((link) => link.document_id)
          .filter((id): id is string => id !== null)
      );
      cleanupDocuments = (documents ?? []).filter(
        (document) => !sharedIds.has(document.id)
      );
    }

    const storagePaths = cleanupDocuments.map((document) => document.storage_path);
    // Keep the staged driver as the retry anchor until external and document
    // cleanup succeeds. A transient storage failure must not strand an orphan.
    if (storagePaths.length > 0) {
      const { error: storageError } = await service.storage
        .from("documents")
        .remove(storagePaths);
      if (storageError) {
        throw new Error(
          `Unable to remove a staged driver file; the driver remains pending for retry: ${storageError.message}`
        );
      }
    }

    const cleanupDocumentIds = cleanupDocuments.map((document) => document.id);
    if (cleanupDocumentIds.length > 0) {
      const { error: documentsDeleteError } = await service
        .from("documents")
        .delete()
        .eq("client_id", ids.data.clientId)
        .eq("client_request_id", driver.request_id)
        .in("id", cleanupDocumentIds);
      if (documentsDeleteError) {
        throw new Error(
          `Stored files were removed, but staged document-row cleanup failed; retry the rejection: ${documentsDeleteError.message}`
        );
      }
    }

    const { data: deletedDriver, error: deleteError } = await service
      .from("drivers")
      .delete()
      .eq("id", driver.id)
      .eq("client_id", ids.data.clientId)
      .eq("source", "client_portal")
      .is("approved_at", null)
      .select("id")
      .maybeSingle();
    if (deleteError) {
      throw new Error(`Unable to reject the pending driver: ${deleteError.message}`);
    }
    if (!deletedDriver) {
      return NextResponse.json(
        {
          error: "The driver changed during review; reload before rejecting it.",
          code: "PENDING_DRIVER_CHANGED",
        },
        { status: 409 }
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "compliance_driver_rejected",
      entity_type: "drivers",
      entity_id: driver.id,
      description: `Client-submitted driver rejected: ${driver.full_name}`,
      metadata: {
        request_id: driver.request_id,
        document_rows_removed: cleanupDocumentIds,
        storage_objects_removed: storagePaths,
      },
    });
    if (activityError) {
      throw new Error(
        `Driver ${driver.id} was rejected, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ success: true, driverId: driver.id });
  } catch (error) {
    return failure(error);
  }
}
