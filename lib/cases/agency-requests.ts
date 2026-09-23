import "server-only";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultResponseDue, pacificDateOnly, type AgencyRequest, type AgencyCaseKind } from "./agency-request-clock";

export class AgencyRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const date = z.string().refine(value => {
  try { return pacificDateOnly(value) === value; } catch { return false; }
}, "Use a valid YYYY-MM-DD date");
const optionalText = z.string().trim().max(500).nullable().optional();
const createSchema = z.object({
  client_id: z.string().uuid(),
  case_kind: z.enum(["dataq", "cpdp"]),
  case_id: z.string().uuid(),
  requested_on: date,
  response_due: date.optional(),
  requesting_agency: z.string().trim().min(1).max(500),
  contact_name: optionalText,
  contact_phone: optionalText,
  contact_email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  // Preserve what the agency actually wrote.
  request_text: z.string().min(1).refine(value => value.trim().length > 0, "Request text is required"),
  created_by: z.string().uuid(),
});
export type CreateAgencyRequestInput = z.input<typeof createSchema>;

export function parseAgencyCaseKind(value: string): AgencyCaseKind {
  if (value !== "dataq" && value !== "cpdp") throw new AgencyRequestError("Unknown case kind");
  return value;
}

export async function requireAgencyCase(caseKind: AgencyCaseKind, caseId: string, clientId?: string) {
  const service = await createServiceClient();
  const { data, error } = await service.from(caseKind === "dataq" ? "dataq_cases" : "cpdp_cases")
    .select("id, client_id").eq("id", z.string().uuid().parse(caseId)).maybeSingle();
  if (error) throw new AgencyRequestError(`Unable to load case: ${error.message}`, 500);
  if (!data || (clientId && data.client_id !== clientId)) throw new AgencyRequestError("Case not found for this client", 404);
  return data as { id: string; client_id: string };
}

export async function listAgencyRequests(caseKind: AgencyCaseKind, caseId: string): Promise<AgencyRequest[]> {
  const service = await createServiceClient();
  const { data, error, count } = await service.from("case_agency_requests").select("*", { count: "exact" })
    .eq("case_kind", caseKind).eq("case_id", caseId).order("requested_on", { ascending: false }).order("id").range(0, 999);
  if (error) throw new AgencyRequestError(`Unable to load agency requests: ${error.message}`, 500);
  if (count !== (data ?? []).length) throw new AgencyRequestError("Agency request list is incomplete", 500);
  return (data ?? []) as AgencyRequest[];
}

export async function listOpenAgencyRequestsForClient(clientId: string): Promise<AgencyRequest[]> {
  const service = await createServiceClient();
  const { data, error, count } = await service.from("case_agency_requests").select("*", { count: "exact" })
    .eq("client_id", clientId).eq("status", "open").order("response_due").order("id").range(0, 999);
  if (error) throw new AgencyRequestError(`Unable to load open agency requests: ${error.message}`, 500);
  if (count !== (data ?? []).length) throw new AgencyRequestError("Open agency request list is incomplete", 500);
  return (data ?? []) as AgencyRequest[];
}

export async function createAgencyRequest(input: CreateAgencyRequestInput): Promise<AgencyRequest> {
  const parsed = createSchema.parse(input);
  const response_due = parsed.response_due ?? defaultResponseDue(parsed.requested_on);
  if (response_due < parsed.requested_on) throw new AgencyRequestError("Respond by cannot be before requested on");
  await requireAgencyCase(parsed.case_kind, parsed.case_id, parsed.client_id);
  const service = await createServiceClient();
  const { data, error } = await service.from("case_agency_requests").insert({
    ...parsed, response_due, status: "open",
    contact_name: parsed.contact_name || null, contact_phone: parsed.contact_phone || null,
    contact_email: parsed.contact_email || null,
  }).select("*").single();
  if (error) throw new AgencyRequestError(`Unable to create agency request: ${error.message}`, 500);
  return data as AgencyRequest;
}

export async function requireAgencyRequestScope(id: string, caseKind: AgencyCaseKind, caseId: string) {
  const caseRow = await requireAgencyCase(caseKind, caseId);
  const service = await createServiceClient();
  const { data, error } = await service.from("case_agency_requests").select("id")
    .eq("id", z.string().uuid().parse(id)).eq("case_kind", caseKind).eq("case_id", caseId)
    .eq("client_id", caseRow.client_id).maybeSingle();
  if (error) throw new AgencyRequestError(`Unable to verify agency request: ${error.message}`, 500);
  if (!data) throw new AgencyRequestError("Agency request not found on this case", 404);
}

async function closeRequest(id: string, status: "responded" | "lapsed", notes: string, respondedOn: string | null) {
  const response_notes = z.string().trim().min(10, "Notes must contain at least 10 characters").parse(notes);
  const service = await createServiceClient();
  const { data, error } = await service.from("case_agency_requests")
    .update({ status, response_notes, responded_on: respondedOn })
    .eq("id", z.string().uuid().parse(id)).eq("status", "open").select("*").maybeSingle();
  if (error) throw new AgencyRequestError(`Unable to mark request ${status}: ${error.message}`, 500);
  if (!data) throw new AgencyRequestError("Request is missing or no longer open; reload the case", 409);
  return data as AgencyRequest;
}

export async function markResponded(id: string, respondedOn: string, notes: string) {
  return closeRequest(id, "responded", notes, date.parse(respondedOn));
}
export async function markLapsed(id: string, notes: string) {
  return closeRequest(id, "lapsed", notes, null);
}
