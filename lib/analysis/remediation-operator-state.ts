export type CorrectionRow = {
  lane: "A" | "B" | "I";
  caseStatus: string | null;
  requestState: "waiting" | "escalated" | "needs_review" | null;
  hasPoliceReport: boolean;
};

const complete = new Set(["closed", "approved", "denied", "won", "lost", "withdrawn", "determination_made"]);
const agencyWaiting = new Set(["filed", "pending", "pending_state", "pending_fmcsa"]);

export function summarizeCorrectionWork(rows: CorrectionRow[], workActionCount: number) {
  const counts = { needsAction: 0, waitingClient: 0, missingPoliceReports: 0, waitingAgency: 0, completed: 0 };
  for (const row of rows) {
    // A response or escalation still needs attention even if a linked case closed.
    if (row.requestState === "escalated" || row.requestState === "needs_review") counts.needsAction++;
    else if (row.caseStatus && complete.has(row.caseStatus)) counts.completed++;
    else if (row.caseStatus && agencyWaiting.has(row.caseStatus)) counts.waitingAgency++;
    else if (row.requestState === "waiting") counts.waitingClient++;
    else if (row.lane === "A" && !row.hasPoliceReport && (!row.caseStatus || row.caseStatus === "draft")) counts.missingPoliceReports++;
    else counts.needsAction++;
  }
  const hasDependencies = counts.waitingClient + counts.missingPoliceReports + counts.waitingAgency > 0;
  return {
    ...counts,
    workActionCount,
    title: counts.needsAction > 0
      ? `${counts.needsAction} correction item${counts.needsAction === 1 ? " needs" : "s need"} action`
      : workActionCount > 0
        ? `No correction step is ready; ${workActionCount} work item${workActionCount === 1 ? " needs" : "s need"} attention`
        : hasDependencies ? "Nothing needs you in this correction queue right now" : "No correction action is currently listed",
    label: counts.needsAction > 0 || workActionCount > 0 ? "Needs attention" : hasDependencies ? "Waiting on records or agency" : "Queue clear",
  };
}
