export type RemediationRequest = {
  id: string;
  violation_id: string | null;
  case_id: string | null;
  case_type: string | null;
  responsibility: string;
  request_type: string | null;
  created_at: string;
  reminder_count: number;
  escalated_at: string | null;
  evidence_status: string | null;
  response: unknown;
};

export function investigationRequestState(
  requests: RemediationRequest[],
  violationId: string,
  caseId: string | null
) {
  const linked = requests.filter(request =>
    request.responsibility === "client" &&
    (request.request_type === "evidence" || request.request_type === "question") &&
    (request.violation_id === violationId ||
      (!request.violation_id && caseId !== null && request.case_type === "dataq" && request.case_id === caseId))
  );
  if (!linked.length) return null;
  const needsReview = linked.some(request => request.evidence_status === "submitted" || request.evidence_status === "applied" || (request.response !== null && request.evidence_status !== "insufficient"));
  const escalated = linked.some(request => request.escalated_at !== null);
  return {
    state: needsReview ? "needs_review" as const : escalated ? "escalated" as const : "waiting" as const,
    label: needsReview ? "Evidence response needs review" : escalated ? "Awaiting client evidence — staff follow-up needed" : "Awaiting client evidence",
    since: linked.map(request => request.created_at).sort()[0],
    reminders: linked.reduce((sum, request) => sum + request.reminder_count, 0),
    requestCount: linked.length,
  };
}
