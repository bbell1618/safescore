import "server-only";
import { serviceClient } from "@/lib/autopilot/queue";
import { TERMS_DOCUMENT, TERMS_HASH, type TermsApproval } from "./terms";

/** The owner's approval of the current wording, or null while it is a draft. */
export async function getTermsApproval(): Promise<TermsApproval | null> {
  const { data, error } = await serviceClient()
    .from("legal_approvals")
    .select("approved_by_name, approved_at")
    .eq("document", TERMS_DOCUMENT)
    .eq("content_hash", TERMS_HASH)
    .is("revoked_at", null)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to read terms approval: ${error.message}`);
  return data ? { name: data.approved_by_name as string, approvedAt: data.approved_at as string } : null;
}

export async function recordTermsApproval(name: string, recordedBy: string): Promise<TermsApproval> {
  const { data, error } = await serviceClient()
    .from("legal_approvals")
    .insert({ document: TERMS_DOCUMENT, content_hash: TERMS_HASH, approved_by_name: name, recorded_by: recordedBy })
    .select("approved_by_name, approved_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Unable to save the approval");
  return { name: data.approved_by_name as string, approvedAt: data.approved_at as string };
}
