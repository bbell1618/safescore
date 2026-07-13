export type RemediationState = "fresh" | "analysis_ready" | "cases_open";

export type RemediationNextStep = {
  state: RemediationState;
  label: string;
  title: string;
  detail: string;
  hrefSuffix: string;
  action: string;
};

export function getRemediationNextStep(params: {
  safetyRecordCount: number;
  actionCount: number;
  openCaseCount: number;
}): RemediationNextStep {
  if (params.safetyRecordCount === 0) {
    return {
      state: "fresh",
      label: "Fresh client",
      title: "Run the initial public FMCSA analysis",
      detail:
        "Import the carrier's current inspections, violations, and crashes before deciding what can be remediated.",
      hrefSuffix: "",
      action: "Return to client overview",
    };
  }

  if (params.openCaseCount > 0) {
    return {
      state: "cases_open",
      label: "Cases open",
      title: "Advance the open filings, then return to the queue",
      detail:
        "Resolve evidence requests and filing steps first. Keep legitimate violations in Lane C for operational correction and monitored age-out.",
      hrefSuffix: "/cases",
      action: "Open case workbench",
    };
  }

  return {
    state: "analysis_ready",
    label: "Analysis ready",
    title:
      params.actionCount > 0
        ? "Work the Action queue in Lane A, Lane B, then Lane C order"
        : "No filing action is currently supported",
    detail:
      params.actionCount > 0
        ? "Review crashes for CPDP first, challenge only genuine violation errors with evidence, and assign operational fixes for the remaining burden. Investigate means collect evidence; it does not mean removable."
        : "Continue monitoring for new activity and let legitimate in-window burden age out while operational controls remain in place.",
    hrefSuffix: "/violations",
    action: params.actionCount > 0 ? "Review violation evidence" : "Review safety history",
  };
}
