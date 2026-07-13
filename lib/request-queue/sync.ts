type SupabaseLike = any;

export type RequestedEvidenceItem = {
  caseType: "dataq" | "cpdp";
  caseId: string;
  evidenceId: string;
  label: string;
  contextNote: string | null;
};

const CLOSED_DATAQ = ["approved", "denied", "closed"];
const CLOSED_CPDP = ["determination_made", "closed"];

/** Consolidate every client-supplied evidence item across open cases into one portal request. */
export async function syncClientEvidenceRequest(service: SupabaseLike, clientId: string) {
  const [{ data: dataqCases, error: dataqError }, { data: cpdpCases, error: cpdpError }] =
    await Promise.all([
      service.from("dataq_cases").select("id, status").eq("client_id", clientId),
      service.from("cpdp_cases").select("id, status").eq("client_id", clientId),
    ]);
  if (dataqError) throw new Error(dataqError.message);
  if (cpdpError) throw new Error(cpdpError.message);

  const openDataqIds = (dataqCases ?? [])
    .filter((row: any) => !CLOSED_DATAQ.includes(row.status))
    .map((row: any) => row.id as string);
  const openCpdpIds = (cpdpCases ?? [])
    .filter((row: any) => !CLOSED_CPDP.includes(row.status))
    .map((row: any) => row.id as string);

  const items: RequestedEvidenceItem[] = [];
  if (openDataqIds.length > 0) {
    const { data, error } = await service
      .from("dataq_evidence")
      .select("id, case_id, label, context_note, status, acquisition_method")
      .in("case_id", openDataqIds)
      .eq("required", true)
      .neq("status", "received");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      // Only client_upload belongs in the portal. GEIA-pull sources such as PAR vendors do not.
      if (row.acquisition_method !== "client_upload") continue;
      items.push({
        caseType: "dataq",
        caseId: row.case_id,
        evidenceId: row.id,
        label: row.label,
        contextNote: row.context_note,
      });
    }
  }

  if (openCpdpIds.length > 0) {
    const { data, error } = await service
      .from("cpdp_evidence")
      .select("id, case_id, doc_type, label, context_note, status")
      .in("case_id", openCpdpIds)
      .eq("required", true)
      .neq("status", "received");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      // Police Accident Reports are obtained by GEIA and must never become a client to-do.
      if (row.doc_type === "police_report") continue;
      items.push({
        caseType: "cpdp",
        caseId: row.case_id,
        evidenceId: row.id,
        label: row.label,
        contextNote: row.context_note,
      });
    }
  }

  const dedupeKey = `${clientId}:case:consolidated-evidence`;
  const now = new Date();
  if (items.length === 0) {
    const { error } = await service
      .from("client_requests")
      .update({ status: "fulfilled", closed_at: now.toISOString(), next_reminder_at: null, updated_at: now.toISOString() })
      .eq("dedupe_key", dedupeKey)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return { status: "fulfilled" as const, itemCount: 0 };
  }

  const nextReminder = new Date(now.getTime() + 7 * 86400000).toISOString();
  const { data, error } = await service
    .from("client_requests")
    .upsert(
      {
        client_id: clientId,
        dedupe_key: dedupeKey,
        category: "case_evidence",
        title: "Documents needed for your open case work",
        description: "Upload the client-held records below. GEIA-obtained records are tracked separately and are not shown here.",
        source: "case",
        responsibility: "client",
        requested_items: items,
        status: "open",
        next_reminder_at: nextReminder,
        closed_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "dedupe_key" }
    )
    .select("id, status, requested_items, next_reminder_at")
    .single();
  if (error) throw new Error(error.message);
  return { status: "open" as const, itemCount: items.length, request: data };
}
