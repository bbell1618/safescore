import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  RosterCollectionResponse,
  RosterDocument,
  RosterDocumentType,
  RosterStagedDriver,
} from "@/lib/roster-collection/roster-types";

export {
  rosterDriverCreateSchema,
  rosterDriverUpdateSchema,
} from "@/lib/roster-collection/roster-validation";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

type OpenRosterRequest = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  submittedAt: string | null;
  response: unknown;
};

type DriverRow = {
  id: string;
  full_name: string;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_class: string | null;
  cdl_expiry: string | null;
  medical_cert_expiry: string | null;
  hired_date: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type DriverDocumentRow = {
  id: string;
  driver_id: string;
  document_id: string | null;
  doc_type: string;
};

type DocumentRow = {
  id: string;
  filename: string;
  mime_type: string | null;
  file_size: number | null;
  status: string;
  created_at: string;
  storage_path?: string;
};

export class RosterRouteFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "RosterRouteFailure";
  }
}

const tokenSchema = z.string().uuid();

export function rosterFailureResponse(error: unknown) {
  if (error instanceof RosterRouteFailure) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Unknown driver-list request failure",
      code: "ROSTER_REQUEST_FAILED",
    },
    { status: 500 }
  );
}

/**
 * Resolve the bearer token exclusively through the service role. Public roster
 * routes never grant anon access to client_requests or compliance tables.
 */
export async function resolveOpenRosterRequest(
  rawToken: string,
  suppliedService?: ServiceClient
): Promise<{ service: ServiceClient; request: OpenRosterRequest }> {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) {
    throw new RosterRouteFailure(
      "This driver-list link is invalid or no longer available.",
      404,
      "ROSTER_LINK_INVALID"
    );
  }
  const service = suppliedService ?? (await createServiceClient());
  const { data: row, error } = await service
    .from("client_requests")
    .select(
      "id, client_id, title, status, request_type, submitted_at, response"
    )
    .eq("upload_token", parsed.data)
    .maybeSingle();
  if (error) {
    throw new RosterRouteFailure(
      `Unable to validate the driver-list link: ${error.message}`,
      500,
      "ROSTER_LINK_LOOKUP_FAILED"
    );
  }
  if (!row || row.request_type !== "roster_collection") {
    throw new RosterRouteFailure(
      "This driver-list link is invalid or no longer available.",
      404,
      "ROSTER_LINK_INVALID"
    );
  }
  if (row.status !== "open") {
    throw new RosterRouteFailure(
      "This driver-list request is closed. Contact your Golden Era SafeScore team if you still need to make a change.",
      410,
      "ROSTER_REQUEST_CLOSED"
    );
  }

  const { data: client, error: clientError } = await service
    .from("clients")
    .select("id, name, tier")
    .eq("id", row.client_id)
    .maybeSingle();
  if (clientError) {
    throw new RosterRouteFailure(
      `Unable to validate the company for this driver-list link: ${clientError.message}`,
      500,
      "ROSTER_CLIENT_LOOKUP_FAILED"
    );
  }
  if (!client || client.tier !== "total_safety") {
    throw new RosterRouteFailure(
      "This driver-list link is not available for this service plan.",
      403,
      "ROSTER_SERVICE_NOT_AVAILABLE"
    );
  }

  return {
    service,
    request: {
      id: row.id,
      clientId: row.client_id,
      clientName: client.name,
      title: row.title,
      submittedAt: row.submitted_at,
      response: row.response,
    },
  };
}

function publicDocument(
  link: DriverDocumentRow,
  document: DocumentRow
): RosterDocument | null {
  if (
    (link.doc_type !== "cdl" && link.doc_type !== "medical_cert") ||
    (document.status !== "pending_review" && document.status !== "reviewed")
  ) {
    return null;
  }
  return {
    id: document.id,
    driverDocumentId: link.id,
    docType: link.doc_type,
    filename: document.filename,
    mimeType: document.mime_type,
    fileSize: document.file_size,
    reviewStatus: document.status,
    createdAt: document.created_at,
  };
}

function publicDriver(
  row: DriverRow,
  documents: RosterDocument[] = []
): RosterStagedDriver {
  return {
    id: row.id,
    fullName: row.full_name,
    cdlNumber: row.cdl_number ?? "",
    cdlState: row.cdl_state ?? "CA",
    cdlClass: row.cdl_class ?? "A",
    cdlExpiry: row.cdl_expiry,
    medicalCertExpiry: row.medical_cert_expiry,
    hiredDate: row.hired_date,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents,
  };
}

export async function loadRosterCollection(
  service: ServiceClient,
  request: OpenRosterRequest
): Promise<RosterCollectionResponse> {
  const { data: driverRows, error: driverError } = await service
    .from("drivers")
    .select(
      "id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, approved_at, created_at, updated_at"
    )
    .eq("client_id", request.clientId)
    .eq("request_id", request.id)
    .eq("source", "client_portal")
    .order("created_at", { ascending: true });
  if (driverError) {
    throw new RosterRouteFailure(
      `Unable to load saved drivers: ${driverError.message}`,
      500,
      "ROSTER_DRIVERS_LOOKUP_FAILED"
    );
  }
  const drivers = (driverRows ?? []) as DriverRow[];
  const driverIds = drivers.map((driver) => driver.id);
  const documentsByDriver = new Map<string, RosterDocument[]>();

  if (driverIds.length > 0) {
    const { data: linkRows, error: linkError } = await service
      .from("driver_documents")
      .select("id, driver_id, document_id, doc_type")
      .eq("client_id", request.clientId)
      .in("driver_id", driverIds)
      .in("doc_type", ["cdl", "medical_cert"]);
    if (linkError) {
      throw new RosterRouteFailure(
        `Unable to load saved driver documents: ${linkError.message}`,
        500,
        "ROSTER_DOCUMENTS_LOOKUP_FAILED"
      );
    }
    const links = (linkRows ?? []) as DriverDocumentRow[];
    const documentIds = links
      .map((link) => link.document_id)
      .filter((id): id is string => Boolean(id));
    if (documentIds.length > 0) {
      const { data: documentRows, error: documentError } = await service
        .from("documents")
        .select("id, filename, mime_type, file_size, status, created_at")
        .eq("client_id", request.clientId)
        .in("id", documentIds);
      if (documentError) {
        throw new RosterRouteFailure(
          `Unable to load saved files: ${documentError.message}`,
          500,
          "ROSTER_FILES_LOOKUP_FAILED"
        );
      }
      const documentById = new Map(
        ((documentRows ?? []) as DocumentRow[]).map((document) => [
          document.id,
          document,
        ])
      );
      for (const link of links) {
        if (!link.document_id) continue;
        const document = documentById.get(link.document_id);
        if (!document) continue;
        const shaped = publicDocument(link, document);
        if (!shaped) continue;
        const current = documentsByDriver.get(link.driver_id) ?? [];
        current.push(shaped);
        documentsByDriver.set(link.driver_id, current);
      }
    }
  }

  return {
    request: {
      id: request.id,
      clientName: request.clientName,
      title: request.title,
      status: "open",
      submittedAt: request.submittedAt,
      response: request.response,
    },
    drivers: drivers.map((driver) =>
      publicDriver(driver, documentsByDriver.get(driver.id) ?? [])
    ),
  };
}

export async function loadScopedStagedDriver(
  service: ServiceClient,
  request: OpenRosterRequest,
  driverId: string
): Promise<DriverRow> {
  const id = tokenSchema.safeParse(driverId);
  if (!id.success) {
    throw new RosterRouteFailure(
      "Saved driver not found for this request.",
      404,
      "ROSTER_DRIVER_NOT_FOUND"
    );
  }
  const { data, error } = await service
    .from("drivers")
    .select(
      "id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, approved_at, created_at, updated_at"
    )
    .eq("id", id.data)
    .eq("client_id", request.clientId)
    .eq("request_id", request.id)
    .eq("source", "client_portal")
    .is("approved_at", null)
    .maybeSingle();
  if (error) {
    throw new RosterRouteFailure(
      `Unable to verify the saved driver: ${error.message}`,
      500,
      "ROSTER_DRIVER_LOOKUP_FAILED"
    );
  }
  if (!data) {
    throw new RosterRouteFailure(
      "Saved driver not found for this request.",
      404,
      "ROSTER_DRIVER_NOT_FOUND"
    );
  }
  return data as DriverRow;
}

export function shapeStagedDriver(row: DriverRow): RosterStagedDriver {
  return publicDriver(row);
}

const ROSTER_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const ROSTER_UPLOAD_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ROSTER_UPLOAD_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
]);

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-140);
  return normalized || "driver-document";
}

export function validateRosterUpload(file: File, rawDocType: FormDataEntryValue | null) {
  if (rawDocType !== "cdl" && rawDocType !== "medical_cert") {
    throw new RosterRouteFailure(
      "Choose either the CDL photo or medical-card photo slot.",
      400,
      "ROSTER_DOCUMENT_TYPE_INVALID"
    );
  }
  if (file.size <= 0) {
    throw new RosterRouteFailure(
      "The selected file is empty.",
      422,
      "ROSTER_DOCUMENT_EMPTY"
    );
  }
  if (file.size > ROSTER_UPLOAD_MAX_BYTES) {
    throw new RosterRouteFailure(
      "The selected file exceeds 25 MB.",
      422,
      "ROSTER_DOCUMENT_TOO_LARGE"
    );
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.trim().toLowerCase();
  const allowed = mime
    ? ROSTER_UPLOAD_MIMES.has(mime)
    : ROSTER_UPLOAD_EXTENSIONS.has(extension);
  if (!allowed) {
    throw new RosterRouteFailure(
      "Use a PDF, JPEG, PNG, WebP, HEIC, or HEIF file.",
      422,
      "ROSTER_DOCUMENT_TYPE_NOT_ALLOWED"
    );
  }
  return rawDocType as RosterDocumentType;
}

async function cleanupNewDocument(
  service: ServiceClient,
  storagePath: string,
  documentId?: string
) {
  const failures: string[] = [];
  const { error: storageError } = await service.storage
    .from("documents")
    .remove([storagePath]);
  if (storageError) {
    // Keep the row as a durable pointer to the object that still needs cleanup.
    failures.push(`storage object: ${storageError.message}`);
    return failures;
  }
  if (documentId) {
    const { error } = await service.from("documents").delete().eq("id", documentId);
    if (error) failures.push(`document row: ${error.message}`);
  }
  return failures;
}

export async function saveRosterDocument(input: {
  service: ServiceClient;
  request: OpenRosterRequest;
  driver: DriverRow;
  docType: RosterDocumentType;
  file: File;
}): Promise<RosterDocument> {
  const storagePath = `${input.request.clientId}/requests/${input.request.id}/drivers/${input.driver.id}/${input.docType}/${randomUUID()}-${safeFilename(input.file.name)}`;
  const { error: uploadError } = await input.service.storage
    .from("documents")
    .upload(storagePath, await input.file.arrayBuffer(), {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    throw new RosterRouteFailure(
      `Unable to store the driver document: ${uploadError.message}`,
      500,
      "ROSTER_DOCUMENT_STORAGE_FAILED"
    );
  }

  const { data: document, error: documentError } = await input.service
    .from("documents")
    .insert({
      client_id: input.request.clientId,
      storage_path: storagePath,
      filename: input.file.name,
      file_size: input.file.size,
      mime_type: input.file.type || null,
      category: "dqf",
      status: "pending_review",
      uploaded_by: null,
      client_request_id: input.request.id,
      evidence_item_key: `driver:${input.driver.id}:${input.docType}`,
    })
    .select("id, filename, mime_type, file_size, status, created_at")
    .maybeSingle();
  if (documentError || !document) {
    const cleanup = await cleanupNewDocument(input.service, storagePath);
    throw new RosterRouteFailure(
      `The file was uploaded, but its record could not be saved: ${
        documentError?.message ?? "row not returned"
      }${cleanup.length ? `; cleanup failed (${cleanup.join("; ")})` : ""}`,
      500,
      "ROSTER_DOCUMENT_RECORD_FAILED"
    );
  }

  const { data: priorLink, error: priorError } = await input.service
    .from("driver_documents")
    .select("id, document_id")
    .eq("client_id", input.request.clientId)
    .eq("driver_id", input.driver.id)
    .eq("doc_type", input.docType)
    .maybeSingle();
  if (priorError) {
    const cleanup = await cleanupNewDocument(input.service, storagePath, document.id);
    throw new RosterRouteFailure(
      `The file was saved, but the existing driver document could not be checked: ${priorError.message}${
        cleanup.length ? `; cleanup failed (${cleanup.join("; ")})` : ""
      }`,
      500,
      "ROSTER_DOCUMENT_LINK_LOOKUP_FAILED"
    );
  }

  const now = new Date().toISOString();
  const linkPayload = {
    client_id: input.request.clientId,
    driver_id: input.driver.id,
    document_id: document.id,
    doc_type: input.docType,
    status: "missing" as const,
    expiry_date:
      input.docType === "cdl"
        ? input.driver.cdl_expiry
        : input.driver.medical_cert_expiry,
    notes: "Client-submitted document awaiting operator review.",
    updated_at: now,
  };
  let link: DriverDocumentRow | null = null;
  let linkError: { code?: string; message: string } | null = null;
  if (priorLink) {
    let mutation = input.service
      .from("driver_documents")
      .update(linkPayload)
      .eq("id", priorLink.id)
      .eq("client_id", input.request.clientId)
      .eq("driver_id", input.driver.id)
      .eq("doc_type", input.docType);
    mutation = priorLink.document_id
      ? mutation.eq("document_id", priorLink.document_id)
      : mutation.is("document_id", null);
    const result = await mutation
      .select("id, driver_id, document_id, doc_type")
      .maybeSingle();
    link = (result.data as DriverDocumentRow | null) ?? null;
    linkError = result.error;
  } else {
    const result = await input.service
      .from("driver_documents")
      .insert(linkPayload)
      .select("id, driver_id, document_id, doc_type")
      .maybeSingle();
    link = (result.data as DriverDocumentRow | null) ?? null;
    linkError = result.error;
  }
  if (linkError || !link) {
    const cleanup = await cleanupNewDocument(input.service, storagePath, document.id);
    const conflict =
      linkError?.code === "23505" || (!linkError && priorLink !== null);
    throw new RosterRouteFailure(
      conflict
        ? `Another upload changed this document slot. Reload the driver list before trying again${
            cleanup.length ? `; cleanup failed (${cleanup.join("; ")})` : ""
          }.`
        : `The file was saved, but it could not be linked to the driver: ${
            linkError?.message ?? "row not returned"
          }${cleanup.length ? `; cleanup failed (${cleanup.join("; ")})` : ""}`,
      conflict ? 409 : 500,
      conflict
        ? "ROSTER_DOCUMENT_CHANGED_CONCURRENTLY"
        : "ROSTER_DOCUMENT_LINK_FAILED"
    );
  }

  if (priorLink?.document_id && priorLink.document_id !== document.id) {
    const [priorDocumentResult, otherLinksResult] = await Promise.all([
      input.service
        .from("documents")
        .select("id, storage_path, client_request_id")
        .eq("id", priorLink.document_id)
        .eq("client_id", input.request.clientId)
        .maybeSingle(),
      input.service
        .from("driver_documents")
        .select("id", { count: "exact", head: true })
        .eq("client_id", input.request.clientId)
        .eq("document_id", priorLink.document_id)
        .neq("id", priorLink.id),
    ]);
    if (priorDocumentResult.error || otherLinksResult.error) {
      throw new RosterRouteFailure(
        `The replacement was linked, but the prior file could not be checked for cleanup: ${
          priorDocumentResult.error?.message ?? otherLinksResult.error?.message
        }`,
        500,
        "ROSTER_PRIOR_DOCUMENT_LOOKUP_FAILED"
      );
    }
    const priorDocument = priorDocumentResult.data;
    if (
      priorDocument &&
      priorDocument.client_request_id === input.request.id &&
      (otherLinksResult.count ?? 0) === 0
    ) {
      const { error: storageCleanupError } = await input.service.storage
        .from("documents")
        .remove([priorDocument.storage_path]);
      if (storageCleanupError) {
        throw new RosterRouteFailure(
          `The replacement was linked, but the prior stored file could not be removed: ${storageCleanupError.message}`,
          500,
          "ROSTER_PRIOR_DOCUMENT_STORAGE_CLEANUP_FAILED"
        );
      }
      const { error: rowCleanupError } = await input.service
        .from("documents")
        .delete()
        .eq("id", priorDocument.id)
        .eq("client_id", input.request.clientId);
      if (rowCleanupError) {
        throw new RosterRouteFailure(
          `The replacement was linked, but the prior document row could not be removed: ${rowCleanupError.message}`,
          500,
          "ROSTER_PRIOR_DOCUMENT_ROW_CLEANUP_FAILED"
        );
      }
    }
  }

  return {
    id: document.id,
    driverDocumentId: link.id,
    docType: input.docType,
    filename: document.filename,
    mimeType: document.mime_type,
    fileSize: document.file_size,
    reviewStatus: "pending_review",
    createdAt: document.created_at,
  };
}

export async function deleteStagedDriverWithDocuments(input: {
  service: ServiceClient;
  request: OpenRosterRequest;
  driver: DriverRow;
}) {
  const { data: links, error: linksError } = await input.service
    .from("driver_documents")
    .select("document_id")
    .eq("client_id", input.request.clientId)
    .eq("driver_id", input.driver.id);
  if (linksError) {
    throw new RosterRouteFailure(
      `Unable to load the driver's files for removal: ${linksError.message}`,
      500,
      "ROSTER_DRIVER_DOCUMENTS_LOOKUP_FAILED"
    );
  }
  const documentIds = (links ?? [])
    .map((link) => link.document_id)
    .filter((id): id is string => Boolean(id));
  let documents: Array<{ id: string; storage_path: string }> = [];
  if (documentIds.length > 0) {
    const [documentsResult, otherLinksResult] = await Promise.all([
      input.service
        .from("documents")
        .select("id, storage_path")
        .eq("client_id", input.request.clientId)
        .eq("client_request_id", input.request.id)
        .in("id", documentIds),
      input.service
        .from("driver_documents")
        .select("document_id")
        .eq("client_id", input.request.clientId)
        .in("document_id", documentIds)
        .neq("driver_id", input.driver.id),
    ]);
    if (documentsResult.error || otherLinksResult.error) {
      throw new RosterRouteFailure(
        `Unable to verify the driver's stored files for removal: ${
          documentsResult.error?.message ?? otherLinksResult.error?.message
        }`,
        500,
        "ROSTER_DRIVER_FILES_LOOKUP_FAILED"
      );
    }
    const sharedIds = new Set(
      (otherLinksResult.data ?? [])
        .map((link) => link.document_id)
        .filter((id): id is string => Boolean(id))
    );
    documents = (documentsResult.data ?? []).filter(
      (document) => !sharedIds.has(document.id)
    );
  }

  // Remove external objects first while the database still holds durable paths.
  // If storage fails, the staged row remains intact and the same operation can retry.
  if (documents.length > 0) {
    const { error: storageError } = await input.service.storage
      .from("documents")
      .remove(documents.map((document) => document.storage_path));
    if (storageError) {
      throw new RosterRouteFailure(
        `Unable to remove a stored driver file: ${storageError.message}`,
        500,
        "ROSTER_DRIVER_STORAGE_CLEANUP_FAILED"
      );
    }
    const { error: documentError } = await input.service
      .from("documents")
      .delete()
      .eq("client_id", input.request.clientId)
      .eq("client_request_id", input.request.id)
      .in(
        "id",
        documents.map((document) => document.id)
      );
    if (documentError) {
      throw new RosterRouteFailure(
        `Stored files were removed, but their document records could not be cleaned up: ${documentError.message}`,
        500,
        "ROSTER_DRIVER_DOCUMENT_CLEANUP_FAILED"
      );
    }
  }

  const { data: deleted, error: deleteError } = await input.service
    .from("drivers")
    .delete()
    .eq("id", input.driver.id)
    .eq("client_id", input.request.clientId)
    .eq("request_id", input.request.id)
    .eq("source", "client_portal")
    .is("approved_at", null)
    .select("id")
    .maybeSingle();
  if (deleteError || !deleted) {
    throw new RosterRouteFailure(
      `Unable to remove the saved driver: ${
        deleteError?.message ?? "driver is no longer editable"
      }`,
      deleteError ? 500 : 409,
      "ROSTER_DRIVER_DELETE_FAILED"
    );
  }
}
