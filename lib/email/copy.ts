/** Presentation only; stored codes, classifications and workflow states stay intact. */
export function plainEmailText(value: string): string {
  return value
    .replace(/\bCPDP\b/g, "crash preventability review")
    .replace(/\bDataQs?\b|\bRDR\b/g, "request to correct a safety record")
    .replace(/\bBASICs?\b/g, "safety category")
    .replace(/\bCDL\b/g, "commercial driver's license")
    .replace(/\bCMV\b/g, "commercial vehicle")
    .replace(/\bOOS\b/g, "out of service (ordered off the road)")
    .replace(/\bweighted burden\b/gi, "violation points, adjusted for how old each event is");
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Being prepared",
  filed: "Submitted to the agency",
  pending: "Waiting for the agency's review",
  pending_state: "Waiting for the state agency's review",
  pending_fmcsa: "Waiting for the federal trucking safety agency's review",
  approved: "Request approved",
  denied: "Request denied",
  reconsidering: "Asking the agency to review its decision again",
  determination_made: "Agency decision received",
  closed: "Review closed",
};

export function emailCaseStatus(value: string): string {
  return STATUS_LABELS[value] ?? "Open your portal for the latest update";
}

const CATEGORY_LABELS: Record<string, string> = {
  unsafe_driving: "Driving safety",
  hos_compliance: "Driving hours and required rest",
  driver_fitness: "Driver qualifications",
  controlled_substance: "Drug and alcohol rules",
  vehicle_maintenance: "Vehicle condition and maintenance",
  hazmat_compliance: "Hazardous materials rules",
  crash_indicator: "Crash history",
};

export function emailSafetyCategory(value: string): string {
  return CATEGORY_LABELS[value] ?? "Safety record";
}
