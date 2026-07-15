/**
 * Challengeability scoring v2 - evidence-driven label model.
 *
 * Challengeability answers whether there is a genuine evidentiary/procedural
 * ground to believe FMCSA's record is wrong. Score impact is still computed and
 * returned for transparency, but it is not part of the challengeability label.
 */

export type ChallengeTier =
  | "strong"
  | "moderate"
  | "investigate"
  | "not_challengeable"
  | "operational";

export const EVIDENCE_OBTAINABILITY_BY_TYPE: Record<string, number> = {
  eld_record: 85,
  driver_log: 75,
  vehicle_inspection: 65,
  hazmat_placard: 60,
  officer_judgment: 20,
  default: 50,
};

export interface ChallengeFactors {
  evidenceObtainability: number;
  evidenceObtainabilityNote: string;
  scoreImpact: number;
  scoreImpactNote: string;
  proceduralGrounds: number;
  proceduralGroundsNote: string;
}

export interface ChallengeScore {
  overall: number;
  challengeable: boolean;
  factors: ChallengeFactors;
  label: ChallengeTier;
  summary: string;
  hypothesis: string;
}

export function getEvidenceTypeForViolation(
  basicCategory: string | null,
  violationCode: string
): string {
  const cat = basicCategory?.toLowerCase() ?? "";
  const code = violationCode?.toLowerCase() ?? "";

  if (cat === "hos_compliance") {
    if (code.includes("eld") || code.includes("aobrd")) return "eld_record";
    return "driver_log";
  }
  if (cat === "driver_fitness") return "driver_log";
  if (cat === "vehicle_maintenance") return "vehicle_inspection";
  if (cat === "hazmat_compliance") return "hazmat_placard";
  if (cat === "controlled_substance") return "officer_judgment";
  if (cat === "crash_indicator") return "officer_judgment";
  if (cat === "unsafe_driving") return "officer_judgment";

  return "default";
}

function scoreEvidenceObtainability(
  evidenceType: string
): { score: number; note: string } {
  const score = EVIDENCE_OBTAINABILITY_BY_TYPE[evidenceType]
    ?? EVIDENCE_OBTAINABILITY_BY_TYPE.default;

  const notes: Record<string, string> = {
    eld_record:
      "ELD/AOBRD records are retained by the carrier and are straightforward to produce.",
    driver_log:
      "Driver logs are retained in the qualification file; availability depends on recordkeeping practices.",
    vehicle_inspection:
      "Inspection/repair records should be in the maintenance file; completeness varies.",
    hazmat_placard:
      "Placard documentation requires cross-referencing hazmat manifests - moderately obtainable.",
    officer_judgment:
      "Finding is based on officer observation; documentary rebuttal is difficult unless the record itself is wrong.",
    default:
      "Evidence availability is uncertain for this violation type.",
  };

  return {
    score,
    note: notes[evidenceType] ?? notes.default,
  };
}

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
  const severityNorm = ((sw - 1) / 9) * 100;
  const recencyFactor = tw / 3;

  let basicFactor = 1.0;
  let basicNote = "";
  if (basicPercentile != null) {
    if (basicPercentile >= 80) {
      basicFactor = 1.3;
      basicNote = " The carrier's BASIC is in the alert threshold - impact of removal is amplified.";
    } else if (basicPercentile >= 65) {
      basicFactor = 1.15;
      basicNote = " BASIC is near the intervention threshold - moderately elevated impact.";
    } else {
      basicNote = " BASIC is below intervention threshold.";
    }
  }

  const raw = severityNorm * recencyFactor * basicFactor;
  const score = clamp(Math.round(raw), 0, 100);
  const note =
    `Severity weight ${sw}/10, time weight ${tw}/3 (recency).` +
    (basicNote || " BASIC percentile not provided - standard impact assumed.");

  return { score, note };
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isUnknownDisposition(citationResult: string | null | undefined) {
  const result = normalized(citationResult);
  return (
    !result ||
    result === "unknown" ||
    result === "pending" ||
    result === "not provided" ||
    result === "n/a"
  );
}

function hasExplicitCitationNumber(citationNumber: string | null | undefined) {
  return Boolean(citationNumber?.trim());
}

export function isCitationBackedViolationCode(violationCode: string | null | undefined) {
  const code = normalized(violationCode).toUpperCase();
  return (
    code === "392.2" ||
    code.startsWith("392.2-") ||
    code === "392.2C" ||
    code === "392.2RG" ||
    code === "392.2SLSNC"
  );
}

function isFavorableDisposition(citationResult: string | null | undefined) {
  const result = normalized(citationResult);
  return (
    result.includes("dismiss") ||
    result.includes("not guilty") ||
    result.includes("no conviction") ||
    result.includes("reduced") ||
    result.includes("withdrawn")
  );
}

function isUpheldDisposition(citationResult: string | null | undefined) {
  const result = normalized(citationResult);
  return (
    result.includes("guilty") ||
    result.includes("convict") ||
    result.includes("upheld") ||
    result.includes("paid") ||
    result.includes("forfeit")
  ) && !isFavorableDisposition(citationResult);
}

function hasRecordDefect(challengeReason: string | null | undefined) {
  const reason = normalized(challengeReason);
  return (
    reason.includes("duplicate") ||
    reason.includes("mismatch") ||
    reason.includes("clerical") ||
    reason.includes("incorrect") ||
    reason.includes("wrong") ||
    reason.includes("not carrier") ||
    reason.includes("not our")
  );
}

function isOperationalCategory(basicCategory: string | null | undefined) {
  return [
    "vehicle_maintenance",
    "unsafe_driving",
    "controlled_substance",
    "hazmat_compliance",
  ].includes(normalized(basicCategory));
}

function tierDecision(params: {
  violationCode: string;
  basicCategory: string | null;
  citationNumber?: string | null;
  citationResult?: string | null;
  challengeReason: string | null;
  oosViolation: boolean;
  convicted: boolean | null;
}): { label: ChallengeTier; proceduralScore: number; note: string; hypothesis: string } {
  const cat = normalized(params.basicCategory);
  const hasCitationNumber = hasExplicitCitationNumber(params.citationNumber);
  const hasCitationBackedCode = isCitationBackedViolationCode(params.violationCode);
  const hasCitationBasis = hasCitationNumber || hasCitationBackedCode;
  const unknownDisposition = isUnknownDisposition(params.citationResult);

  if (isFavorableDisposition(params.citationResult) || params.convicted === false) {
    return {
      label: "strong",
      proceduralScore: 90,
      note: "Citation disposition indicates dismissal, reduction, not-guilty, or no conviction - confirmed DataQs ground.",
      hypothesis: "Use the favorable court disposition to remove or correct the violation record.",
    };
  }

  if (hasRecordDefect(params.challengeReason)) {
    const duplicate = normalized(params.challengeReason).includes("duplicate");
    return {
      label: "moderate",
      proceduralScore: 70,
      note: duplicate
        ? "A duplicate or record-level defect has been identified; evidence should confirm the duplicate before filing."
        : "A clear record-level defect has been identified; evidence should confirm the mismatch before filing.",
      hypothesis: duplicate
        ? "Confirm whether FMCSA has duplicated the inspection or violation."
        : "Confirm whether the inspection record was incorrectly coded or attributed.",
    };
  }

  if (hasCitationBasis && unknownDisposition) {
    const note = hasCitationNumber
      ? "Citation number is present, but the court disposition is unknown; do not call this not-challengeable until the disposition is known."
      : "This is a citation-backed state/local-law violation code, but no court disposition is available; inspect the report and disposition before deciding whether a DataQs path exists.";
    return {
      label: "investigate",
      proceduralScore: 45,
      note,
      hypothesis: hasCitationNumber
        ? "Investigate citation disposition before deciding whether a DataQs challenge exists."
        : "Review the inspection report for ticket/disposition details and any recording error before deciding whether a DataQs challenge exists.",
    };
  }

  if (cat === "hos_compliance" || cat === "driver_fitness") {
    return {
      label: "investigate",
      proceduralScore: 35,
      note: "This category can turn on carrier-held records and inspection-report coding, but the current feed does not prove a defect; if the records match the inspection report, this is not challengeable.",
      hypothesis:
        cat === "hos_compliance"
          ? "Review logs/ELD records and the inspection report for a timing or recording error."
          : "Review the driver qualification file and inspection report for a documentation mismatch.",
    };
  }

  if (params.oosViolation && cat === "vehicle_maintenance" && !hasCitationBasis) {
    return {
      label: "operational",
      proceduralScore: 5,
      note: "OOS vehicle-maintenance finding with no citation-disposition or record-defect signal; remedy is repair process and time decay.",
      hypothesis: "Treat as an operational maintenance action unless later evidence shows the inspection record is wrong.",
    };
  }

  if (isUpheldDisposition(params.citationResult) || params.convicted === true) {
    return {
      label: "not_challengeable",
      proceduralScore: 5,
      note: "Disposition indicates the citation or finding was upheld, and no separate record defect is present.",
      hypothesis: "No DataQs path is currently supported by the available evidence.",
    };
  }

  if (isOperationalCategory(cat)) {
    return {
      label: "operational",
      proceduralScore: 10,
      note: "No record-specific challenge ground is present; this is a coaching, shop, compliance, or time-decay action.",
      hypothesis: "Work the operational fix and monitor decay unless new evidence reveals a record error.",
    };
  }

  return {
    label: "investigate",
    proceduralScore: 30,
    note: "The roadside inspection report can be auto-reviewed for a recording error; if the record is accurate, this is not challengeable.",
    hypothesis: "Review the inspection report and carrier-held documents for a record-specific defect before closing the door.",
  };
}

function buildSummary(
  label: ChallengeTier,
  overall: number,
  note: string
): string {
  switch (label) {
    case "strong":
      return `Strong challenge candidate (score ${overall}) - confirmed evidence supports a DataQs ground.`;
    case "moderate":
      return `Moderate challenge candidate (score ${overall}) - a record-level defect is indicated, but evidence still needs to confirm it.`;
    case "investigate":
      return `Investigate (score ${overall}) - plausible DataQs path, but evidence is missing; this is not a winnability claim. ${note}`;
    case "not_challengeable":
      return `Not challengeable (score ${overall}) - available evidence affirmatively shows no DataQs path.`;
    case "operational":
      return `Operational action (score ${overall}) - fix through coaching, maintenance, compliance controls, or time decay unless new evidence shows a record error.`;
  }
}

export function scoreChallenge(params: {
  violationCode: string;
  basicCategory: string | null;
  severityWeight: number | null;
  timeWeight: number | null;
  challengeReason: string | null;
  oosViolation: boolean;
  convicted: boolean | null;
  citationNumber?: string | null;
  citationResult?: string | null;
  challengeTier?: ChallengeTier | null;
  basicPercentile?: number | null;
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
  const computedDecision = tierDecision({
    violationCode: params.violationCode,
    basicCategory: params.basicCategory,
    citationNumber: params.citationNumber,
    citationResult: params.citationResult,
    challengeReason: params.challengeReason,
    oosViolation: params.oosViolation,
    convicted: params.convicted,
  });
  const decision = params.challengeTier
    ? {
        ...computedDecision,
        label: params.challengeTier,
        proceduralScore: {
          strong: 90,
          moderate: 70,
          investigate: 35,
          not_challengeable: 5,
          operational: 10,
        }[params.challengeTier],
        note: params.challengeReason || computedDecision.note,
      }
    : computedDecision;

  const overall = clamp(
    Math.round(decision.proceduralScore * (0.6 + 0.4 * (evidenceResult.score / 100))),
    0,
    100
  );

  const factors: ChallengeFactors = {
    evidenceObtainability: evidenceResult.score,
    evidenceObtainabilityNote: evidenceResult.note,
    scoreImpact: impactResult.score,
    scoreImpactNote: impactResult.note,
    proceduralGrounds: decision.proceduralScore,
    proceduralGroundsNote: decision.note,
  };

  return {
    overall,
    challengeable: decision.label === "strong" || decision.label === "moderate",
    factors,
    label: decision.label,
    hypothesis: decision.hypothesis,
    summary: buildSummary(decision.label, overall, decision.note),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
