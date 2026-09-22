import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { loadPortalActivityCases, type PortalActivityCase } from "./activity-server";

export type PortalProgressCase = PortalActivityCase & { responseDeadline: string | null };

/** Read only after the linked client's case visibility gate has passed. */
export async function loadPortalProgressCases(clientId: string): Promise<PortalProgressCase[]> {
  const service = await createServiceClient();
  const [cases, deadlines] = await Promise.all([
    loadPortalActivityCases(clientId),
    service.from("dataq_cases").select("id,state_deadline").eq("client_id", clientId),
  ]);
  if (deadlines.error) throw new Error(`Unable to load recorded response deadlines: ${deadlines.error.message}`);
  const byId = new Map((deadlines.data ?? []).map(row => [row.id, row.state_deadline]));
  return cases.map(row => ({ ...row, responseDeadline: row.caseType === "dataq" ? byId.get(row.id) ?? null : null }));
}
