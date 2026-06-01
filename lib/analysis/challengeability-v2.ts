/**
 * Challengeability scoring v2 — transparent, factor-based scoring
 *
 * Replaces the category-heuristic approach in challengeability.ts with a
 * documented numeric model. Each dimension is scored 0–100 and combined via
 * weighted average to produce an overall score.
 *
 * Weight rationale:
 *   evidence_obtainability  40% — can the client actually get the docs?
 *   score_impact            35% — does winning this challenge move the needle?
 *   procedural_grounds      25% — is there a known procedural vector?
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
// Scoring weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const WEIGHT_EVIDENCE = 0.40;
const WEIGHT_IMPACT = 0.35;
const WEIGHT_PROCEDURAL = 0.25;

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
  if (cat === "controlled_substances_alcohol" || cat === "driver_behavior") {
    return "officer_judgment";
  }

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
  convicted: boolean,
  challengeReason: string | null
): { score: number; note: string } {
  const cat = basicCategory?.toLowerCase() ?? "";

  // Not convicted: strongest procedural ground — evidentiary absence
  if (!convicted) {
    return {
      score: 90,
      note:
        "Violation not convicted — DataQs challenge on evidentiary basis has high procedural standing.",
    };
  }

  // OOS violations with conviction: procedural grounds are weakest
  if (oosViolation && cat === "vehicle_maintenance") {
    return {
      score: 10,
      note:
        "OOS vehicle maintenance violation with conviction — documented record limits procedural angles.",
    };
  }

  // HOS: ELD/log timeline discrepancies are a well-documented DataQs vector
  if (cat === "hos_compliance") {
    return {
      score: 70,
      note:
        "HOS violations frequently overturned on timeline or ELD data discrepancy grounds.",
    };
  }

  // Driver fitness: documentation-based challenge is established
  if (cat === "driver_fitness") {
    return {
      score: 65,
      note:
        "Driver fitness findings can be challenged by producing the full qualification file.",
    };
  }

  // Hazmat: regulatory findings are difficult to procedurally overturn
  if (cat === "hazmat_compliance") {
    return {
      score: 15,
      note:
        "Hazmat compliance violations carry strong regulatory standing — procedural grounds are narrow.",
    };
  }

  // If a challenge reason string is provided (from AI or prior analysis), treat it
  // as a signal that a specific angle was identified.
  if (challengeReason && challengeReason.trim().length > 10) {
    return {
      score: 55,
      note:
        "A specific challenge reason was identified — moderate procedural ground to pursue DataQs.",
    };
  }

  // Default
  return {
    score: 40,
    note:
      "No specific procedural vector identified; standard DataQs review may surface grounds.",
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
  switch (label) {
    case "strong":
      return (
        `Strong challenge candidate (score ${overall}) — evidence is obtainable, ` +
        `score impact is meaningful, and a clear procedural vector exists.`
      );
    case "moderate":
      return (
        `Moderate challenge candidate (score ${overall}) — at least one dimension ` +
        `is strong but others limit confidence.`
      );
    case "weak":
      return (
        `Weak challenge candidate (score ${overall}) — limited evidence availability ` +
        `or narrow procedural grounds reduce the likelihood of success.`
      );
    case "not_challengeable":
      return (
        `Not recommended for challenge (score ${overall}) — evidence is difficult ` +
        `to obtain, impact is low, and no clear procedural grounds were identified.`
      );
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function scoreChallenge(params: {
  violationCode: string;
  basicCategory: string | null;
  severityWeight: number | null;
  timeWeight: number | null;          // 1=old, 2=mid, 3=recent
  challengeReason: string | null;
  oosViolation: boolean;
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
  // convicted is not in the scoreChallenge params — callers pass challengeReason
  // to signal non-convicted path. Treat absence of challengeReason as neutral (convicted=true)
  // so the function is conservative by default.
  const inferredConvicted = params.challengeReason == null ||
    !params.challengeReason.toLowerCase().includes("not convicted");

  const proceduralResult = scoreProceduralGrounds(
    params.basicCategory,
    params.oosViolation,
    inferredConvicted,
    params.challengeReason
  );

  const overall = clamp(
    Math.round(
      evidenceResult.score * WEIGHT_EVIDENCE +
        impactResult.score * WEIGHT_IMPACT +
        proceduralResult.score * WEIGHT_PROCEDURAL
    ),
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
