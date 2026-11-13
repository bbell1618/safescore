// QF-198: pure planning for the carrier-side sender. No I/O here so it can be tested with node:test.
// GoldenDesk records the decision (queue row -> 'approved' or 'rejected'); only the sender emails.

export type ApprovedRow = {
  id: string;
  kind: string;
  status: string;
  editable: boolean;
  edited: boolean;
  to_address: string | null;
  cc: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  from_identity: string;
  payload: Record<string, unknown> | null;
  send_result: unknown;
};

export type SendPlan =
  | { action: "skip"; reason: string }
  | { action: "apply_only" } // playbook_publish, filing_packet: run the approval hooks, send nothing
  | { action: "fail"; reason: string }
  | { action: "email"; to: string; cc: string | null; subject: string; rerender: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function planSend(row: ApprovedRow): SendPlan {
  if (row.status !== "approved") return { action: "skip", reason: "not approved" };
  if (row.send_result !== null && row.send_result !== undefined) return { action: "skip", reason: "already claimed" };
  if (row.kind === "needs_info") return { action: "skip", reason: "needs an answer, not a send" };
  if (row.kind === "playbook_publish" || row.kind === "filing_packet") return { action: "apply_only" };
  if (row.kind !== "email" && row.kind !== "report_send") return { action: "skip", reason: `unknown kind ${row.kind}` };
  const to = row.to_address?.trim() ?? "";
  if (!to || !EMAIL_RE.test(to)) return { action: "fail", reason: "Missing or invalid recipient." };
  if (!row.subject?.trim()) return { action: "fail", reason: "Missing subject." };
  const hasBody = Boolean(row.body_html?.trim()) || Boolean(row.body_text?.trim());
  if (!hasBody) return { action: "fail", reason: "Missing body." };
  // A body edited in GoldenDesk only changes body_text; the HTML must be rebuilt from it.
  const rerender = row.edited && row.editable && Boolean(row.body_text?.trim());
  return { action: "email", to, cc: row.cc?.trim() || null, subject: row.subject.trim(), rerender: rerender || !row.body_html?.trim() };
}
