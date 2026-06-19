/**
 * Challengeability scoring v2 - grounds-only label model.
 *
 * Challengeability answers whether there is a genuine evidentiary/procedural
 * ground to believe FMCSA's record is wrong. Score impact is still computed and
 * returned for transparency, but it is not part of the challengeability label.
 */

// ---------------------------------------------------------------------------
// Evidence obtainability lookup table
// Adjust weights here; downstream consumers pick up the change automatically.
// ---------------------------------------------------------------------------

export const EVIDENCE_OBTAINABILITY_BY_TYPE: Record<string, number> = {
  eld_record: 85,       // ELD/AOBRD data — high, client has it
  driver_log: 75,
  vehicle_inspection: 65,
  hazmat_placard: 60,
  officer_judgment: 20, // subjective — low
  default: 50,
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ChallengeFactors {
  /** Can the client realistically provide refuting documents? 0–100 */
  evidenceObtainability: number;
  evidenceObtainabilityNote: string;
  /** Severity × recency × BASIC-elevated proxy — how much does winning move the score? 0–100 */
  scoreImpact: number;
  scoreImpactNote: string;
  /** Is there a known procedural challenge vector? 0–100 */
  proceduralGrounds: number;
  proceduralGroundsNote: string;
}

export interface ChallengeScore {
  /** Weighted composite 0–100 */
  overall: number;
  /** overall >= 50 */
  challengeable: boolean;
  factors: ChallengeFactors;
  label: "strong" | "moderate" | "weak" | "not_challengeable";
  /** One-sentence human-readable explanation */
  summary: string;
}

// ---------------------------------------------------------------------------
// Helper — evidence type inference
// ---------------------------------------------------------------------------

/**
 * Infers the most likely evidence type key (from EVIDENCE_OBTAINABILITY_BY_TYPE)
 * for a given BASIC category and violation code.
 */
export function getEvidenceTypeForViolation(
  basicCategory: string | null,
  violationCode: string
): string {
  const cat = basicCategory?.toLowerCase() ?? "";
  const code = violationCode?.toLowerCase() ?? "";

  // HOS / ELD
  if (cat === "hos_compliance") {
    if (code.includes("eld") || code.includes("aobrd")) return "eld_record";
    return "driver_log";
  }

  // Driver fitness — paper-based qualification file
  if (cat === "driver_fitness") return "driver_log";

  // Vehicle maintenance — inspection report
  if (cat === "vehicle_maintenance") return "vehicle_inspection";

  // Hazmat — placard / documentation
  if (cat === "hazmat_compliance") return "hazmat_placard";

  // Controlled substances / driver behavior — largely officer judgment
  if (cat === "controlled_substance") return "officer_judgment";

  // Crash indicator — reconstructed, partially officer judgment
  if (cat === "crash_indicator") return "officer_judgment";

  // Unsafe driving — often officer judgment
  if (cat === "unsafe_driving") return "officer_judgment";

  return "default";
}

// ---------------------------------------------------------------------------
// Internal scoring helpers
// ---------------------------------------------------------------------------

/**
 * Score evidence obtainability for a violation.
 * Returns { score, note }.
 */
function scoreEvidenceObtainability(
  evidenceType: string
): { score: number; note: string } {
  const score = EVIDENCE_OBTAINABILITY_BY_TYPE[evidenceType]
    ?? EVIDENCE_OBTAINABILITY_BY_TYPE["default"];

  const notes: Record<string, string> = {
    eld_record:
      "ELD/AOBRD records are retained by the carrier and are straightforward to produce.",
    driver_log:
      "Driver logs are retained in the qualification file; availability depends on recordkeeping practices.",
    vehicle_inspection:
      "Inspection/repair records should be in the maintenance file; completeness varies.",
    hazmat_placard:
      "Placard documentation requires cross-referencing hazmat manifests — moderately obtainable.",
    officer_judgment:
      "Finding is based on officer observation; documentary rebuttal is difficult.",
    default:
      "Evidence availability is uncertain for this violation type.",
  };

  return {
    score,
    note: notes[evidenceType] ?? notes["default"],
  };
}

/**
 * Score how much impact a successful challenge would have.
 * Inputs: severityWeight (1–10 FMCSA scale), timeWeight (1=old, 2=mid, 3=recent),
 * and an optional BASIC percentile proxy.
 */
function scoreImpact(
  severityWeight: number | null,
  timeWeight: number | null,
  basicPercentile: number | null | undefined
): { score: number; note: string } {
  if (timeWeight === 0) {
    return {
      score: 0,
      note: "Violation has aged out of the 24-month SMS window - no current score impact.",
    };
  }

  const sw = clamp(severityWeight ?? 5, 1, 10);
  const tw = clamp(timeWeight ?? 2, 1, 3);

  // Severity normalized to 0–100
  const severityNorm = ((sw - 1) / 9) * 100;

  // Time weight: recent violations carry more weight in SMS (FMCSA time-decay)
  // tw=3 (recent) → full weight; tw=1 (old) → 33% weight
  const recencyFactor = tw / 3;

  // BASIC percentile proxy: if percentile is known and elevated (>= 65 intervention threshold),
  // the BASIC is already flagged — removing a violation in that BASIC has higher impact.
  let basicFactor = 1.0;
  let basicNote = "";
  if (basicPercentile != null) {
    if (basicPercentile >= 80) {
      basicFactor = 1.3;
      basicNote = " The carrier's BASIC is in the alert threshold — impact of removal is amplified.";
    } else if (basicPercentile >= 65) {
      basicFactor = 1.15;
      basicNote = " BASIC is near the intervention threshold — moderately elevated impact.";
    } else {
      basicNote = " BASIC is below intervention threshold.";
    }
  }

  const raw = severityNorm * recencyFactor * basicFactor;
  const score = clamp(Math.round(raw), 0, 100);

  const note =
    `Severity weight ${sw}/10, time weight ${tw}/3 (recency).` +
    (basicNote || " BASIC percentile not provided — standard impact assumed.");

  return { score, note };
}

/**
 * Score procedural grounds — likelihood that a known procedural challenge
 * vector exists for this violation category.
 */
function scoreProceduralGrounds(
  basicCategory: string | null,
  oosViolation: boolean,
  convicted: boolean | null,
  challengeReason: string | null
): { score: number; note: string } {
  const cat = basicCategory?.toLowerCase() ?? "";

  // STRONG, record-specific: positive evidence the citation was dismissed/reduced/not-guilty.
  // The FMCSA feed carries no disposition; null is UNKNOWN, never "not convicted".
  if (convicted === false) {
    return { score: 90, note: "Citation recorded as dismissed/reduced/not-guilty - strong evidentiary ground for a DataQs challenge." };
  }

  // MODERATE, record-specific: a concrete defect/reason has been identified for THIS record.
  if (challengeReason && challengeReason.trim().length > 10) {
    return { score: 70, note: "A specific, record-level defect was identified - a concrete procedural ground to pursue DataQs." };
  }

  // WEAK, category-level only: these categories are SOMETIMES challengeable, but a category
  // alone is not a ground - treat as "worth a closer look", not a confirmed challenge.
  if (cat === "hos_compliance") {
    return { score: 30, note: "HOS violations are sometimes overturned on timeline/ELD-discrepancy grounds, but no record-specific discrepancy has been identified - review before treating as challengeable." };
  }
  if (cat === "driver_fitness") {
    return { score: 28, note: "Driver-fitness findings can sometimes be cured with the qualification file, but no specific defect has been identified yet." };
  }

  // NOT challengeable: operational/observed violations with no record-specific ground.
  if (oosViolation && cat === "vehicle_maintenance") {
    return { score: 5, note: "OOS vehicle-maintenance finding - documented roadside condition; operational fix, not a data challenge." };
  }
  return {
    score: 10,
    note: "No record-specific ground identified and disposition is unknown - operational, not a DataQs candidate.",
  };
}

// ---------------------------------------------------------------------------
// Label mapping
// ---------------------------------------------------------------------------

function scoreToLabel(
  overall: number
): "strong" | "moderate" | "weak" | "not_challengeable" {
  if (overall >= 75) return "strong";
  if (overall >= 50) return "moderate";
  if (overall >= 25) return "weak";
  return "not_challengeable";
}

function buildSummary(
  label: "strong" | "moderate" | "weak" | "not_challengeable",
  overall: number,
  factors: ChallengeFactors
): string {
  void factors;

  switch (label) {
    case "strong":
      return `Strong challenge candidate (score ${overall}) - a record-specific evidentiary ground exists (dismissed/reduced citation or an identified defect).`;
    case "moderate":
      return `Moderate challenge candidate (score ${overall}) - a concrete record-level ground was identified; evidence obtainability sets the confidence.`;
    case "weak":
      return `Worth review, not a confirmed challenge (score ${overall}) - this category is sometimes challengeable, but no record-specific ground has been identified; treat as operational unless a specific defect is found.`;
    case "not_challengeable":
      return `Not a challenge candidate (score ${overall}) - no record-specific ground; operational fix and natural 24-month decay.`;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function scoreChallenge(params: {
  violationCode: string;
  basicCategory: string | null;
  severityWeight: number | null;
  timeWeight: number | null;          // 0=aged off, 1=old, 2=mid, 3=recent
  challengeReason: string | null;
  oosViolation: boolean;
  convicted: boolean | null;          // null = unknown; never infer non-conviction
  basicPercentile?: number | null;    // pass if available; null = use proxy
}): ChallengeScore {
  const evidenceType = getEvidenceTypeForViolation(
    params.basicCategory,
    params.violationCode
  );

  const evidenceResult = scoreEvidenceObtainability(evidenceType);
  const impactResult = scoreImpact(
    params.severityWeight,
    params.timeWeight,
    params.basicPercentile
  );
  const proceduralResult = scoreProceduralGrounds(
    params.basicCategory,
    params.oosViolation,
    params.convicted,
    params.challengeReason
  );

  // Challengeability label reflects GROUNDS only - never score impact.
  // Procedural/evidentiary grounds are primary; evidence obtainability can only
  // modify a real ground DOWNWARD (you may have grounds but struggle to prove them).
  // scoreImpact is still computed and returned in `factors` for display, but it is
  // NOT part of the label - score impact is the prioritization axis (points), handled
  // separately in basic-measure / the remediation queue.
  const overall = clamp(
    Math.round(proceduralResult.score * (0.6 + 0.4 * (evidenceResult.score / 100))),
    0,
    100
  );

  const challengeable = overall >= 50;
  const label = scoreToLabel(overall);

  const factors: ChallengeFactors = {
    evidenceObtainability: evidenceResult.score,
    evidenceObtainabilityNote: evidenceResult.note,
    scoreImpact: impactResult.score,
    scoreImpactNote: impactResult.note,
    proceduralGrounds: proceduralResult.score,
    proceduralGroundsNote: proceduralResult.note,
  };

  return {
    overall,
    challengeable,
    factors,
    label,
    summary: buildSummary(label, overall, factors),
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
