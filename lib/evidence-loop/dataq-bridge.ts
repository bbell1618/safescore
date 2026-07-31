import type { SupabaseClient } from "@supabase/supabase-js";

type RequestItem = {
  itemKey?: string;
  label?: string;
  contextNote?: string;
};

type LinkedDocument = {
  id: string;
  storage_path: string;
  evidence_item_key: string | null;
  created_at: string;
};

function bridgeDocType(evidenceClass: string, itemKey: string) {
  return `lane_b_${evidenceClass}_${itemKey}`.replace(/[^a-z0-9_]+/gi, "_");
}

const LEGACY_DOC_TYPES_BY_ITEM: Record<string, readonly string[]> = {
  "certified-court-disposition": ["court_disposition"],
  "repair-invoices": ["maintenance_record"],
  "driver-copy": ["inspection_report"],
  registration: ["vehicle_registration", "registration"],
  lease: ["lease_agreement", "lease"],
  "driver-roster": ["driver_roster", "driver_statement"],
  "eld-gps": ["eld_records", "gps_records"],
  vin: ["vehicle_registration", "registration"],
  "inspection-time": ["inspection_report"],
  "authenticated-trip-data": ["eld_records", "gps_records"],
  photos: ["photos"],
};

export async function bridgeLaneBRequestToDataqCase(
  service: SupabaseClient,
  input: {
    clientId: string;
    requestId: string;
    violationId: string;
    caseId: string;
  }
) {
  const [{ data: caseRow, error: caseError }, { data: request, error: requestError }] =
    await Promise.all([
      service
        .from("dataq_cases")
        .select("id, client_id, violation_id")
        .eq("id", input.caseId)
        .eq("client_id", input.clientId)
        .eq("violation_id", input.violationId)
        .single(),
      service
        .from("client_requests")
        .select("id, evidence_class, requested_items")
        .eq("id", input.requestId)
        .eq("client_id", input.clientId)
        .eq("violation_id", input.violationId)
        .eq("request_type", "evidence")
        .single(),
    ]);
  if (caseError || !caseRow) {
    throw new Error(
      `Unable to verify DataQ case for evidence bridge: ${
        caseError?.message ?? "row not found"
      }`
    );
  }
  if (requestError || !request || !request.evidence_class) {
    throw new Error(
      `Unable to verify typed request for DataQ evidence bridge: ${
        requestError?.message ?? "row not found or class missing"
      }`
    );
  }

  const { data: documents, error: documentsError } = await service
    .from("documents")
    .select("id, storage_path, evidence_item_key, created_at")
    .eq("client_id", input.clientId)
    .eq("client_request_id", input.requestId)
    .eq("violation_id", input.violationId)
    .not("evidence_item_key", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (documentsError) {
    throw new Error(`Unable to load documents for DataQ bridge: ${documentsError.message}`);
  }
  const documentRows = (documents ?? []) as unknown as LinkedDocument[];
  if (documentRows.length === 0) return { bridged: 0, documentIds: [] as string[] };

  const { data: linkedDocuments, error: linkError } = await service
    .from("documents")
    .update({ case_type: "dataq", case_id: input.caseId })
    .eq("client_id", input.clientId)
    .eq("client_request_id", input.requestId)
    .eq("violation_id", input.violationId)
    .in(
      "id",
      documentRows.map((document) => document.id)
    )
    .select("id");
  if (linkError || (linkedDocuments ?? []).length !== documentRows.length) {
    throw new Error(
      `Unable to attach every request document to DataQ case: ${
        linkError?.message ??
        `updated ${(linkedDocuments ?? []).length} of ${documentRows.length}`
      }`
    );
  }

  const requestedItems = (request.requested_items ?? []) as RequestItem[];
  const itemByKey = new Map(
    requestedItems.flatMap((item) =>
      typeof item.itemKey === "string" ? [[item.itemKey, item] as const] : []
    )
  );
  const latestByItem = new Map<string, LinkedDocument>();
  for (const document of documentRows) {
    if (document.evidence_item_key && !latestByItem.has(document.evidence_item_key)) {
      latestByItem.set(document.evidence_item_key, document);
    }
  }

  const bridgedIds: string[] = [];
  for (const [itemKey, document] of latestByItem) {
    const requestedItem = itemByKey.get(itemKey);
    if (!requestedItem) {
      throw new Error(
        `Document ${document.id} item ${itemKey} is not part of request ${input.requestId}`
      );
    }
    const bridgePayload = {
          case_id: input.caseId,
          doc_type: bridgeDocType(request.evidence_class, itemKey),
          label: requestedItem.label ?? itemKey,
          context_note: requestedItem.contextNote ?? null,
          required: true,
          status: "received",
          storage_path: document.storage_path,
          storage_bucket: "documents",
          uploaded_at: new Date().toISOString(),
          uploaded_by: "client",
          acquisition_method: "client",
          client_request_id: input.requestId,
          document_id: document.id,
          evidence_item_key: itemKey,
        };
    const { data: existingBridge, error: existingBridgeError } = await service
      .from("dataq_evidence")
      .select("id")
      .eq("client_request_id", input.requestId)
      .eq("evidence_item_key", itemKey)
      .limit(1)
      .maybeSingle();
    if (existingBridgeError) {
      throw new Error(
        `Unable to inspect the DataQ evidence bridge: ${existingBridgeError.message}`
      );
    }
    let targetId = existingBridge?.id ?? null;
    if (!targetId) {
      const legacyDocTypes = LEGACY_DOC_TYPES_BY_ITEM[itemKey] ?? [];
      if (legacyDocTypes.length > 0) {
        const { data: legacySlot, error: legacyError } = await service
          .from("dataq_evidence")
          .select("id")
          .eq("case_id", input.caseId)
          .is("client_request_id", null)
          .in("doc_type", legacyDocTypes)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (legacyError) {
          throw new Error(
            `Unable to inspect legacy DataQ evidence slots: ${legacyError.message}`
          );
        }
        targetId = legacySlot?.id ?? null;
      }
    }

    const bridgeResult = targetId
      ? await service
          .from("dataq_evidence")
          .update(bridgePayload)
          .eq("id", targetId)
          .select("id")
          .maybeSingle()
      : await service
          .from("dataq_evidence")
          .upsert(bridgePayload, {
            onConflict: "client_request_id,evidence_item_key",
          })
          .select("id")
          .maybeSingle();
    const { data: bridge, error: bridgeError } = bridgeResult;
    if (bridgeError || !bridge) {
      throw new Error(
        `Unable to bridge document ${document.id} into DataQ evidence: ${
          bridgeError?.message ?? "row not returned"
        }`
      );
    }
    bridgedIds.push(bridge.id);
  }

  return {
    bridged: bridgedIds.length,
    documentIds: documentRows.map((document) => document.id),
    evidenceIds: bridgedIds,
  };
}
