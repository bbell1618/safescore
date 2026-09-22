import "server-only";
import type { ClientRequestRow } from "./requests-types";
import type { getPortalClientPageContext } from "@/lib/portal/access";
type PortalSupabase = Awaited<ReturnType<typeof getPortalClientPageContext>>["supabase"];
export async function loadPortalRequests(
  supabase: PortalSupabase,
  clientId: string,
  includeCompliance: boolean,
  includeEvidenceRequests: boolean,
  openOnly = false
): Promise<ClientRequestRow[]> {
  let query = supabase
    .from("client_requests")
    .select(
      "id, category, title, description, requested_items, request_type, evidence_class, why_copy, potential_points, status, evidence_status, status_copy, due_at, upload_token, submitted_at, created_at"
    )
    .eq("client_id", clientId)
    .eq("responsibility", "client")
    .neq("status", "cancelled")
    .or(
      "status.eq.open,evidence_status.in.(submitted,applied,insufficient)"
    );

  if (openOnly) query = query.eq("status", "open");

  if (!includeCompliance) {
    query = query.not(
      "category",
      "in",
      "(mcs150_truth_up,dqf_roster,compliance_renewal)"
    );
  }
  if (!includeEvidenceRequests) {
    query = query.eq("category", "fmcsa_portal_pin");
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error) {
    throw new Error(`Unable to load document requests: ${error.message}`);
  }
  const rows = (data ?? []) as ClientRequestRow[];
  return includeCompliance
    ? rows
    : rows.filter((row) => row.request_type !== "roster_collection");
}

