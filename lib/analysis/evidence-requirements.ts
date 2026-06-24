import type { ChallengeScore } from "./challengeability-v2";

export type EvidenceAcquisitionMethod = "auto" | "client" | "manual";

export interface EvidenceRequirement {
  docType: string;
  label: string;
  neededReason: string;
  acquisitionMethod: EvidenceAcquisitionMethod;
  autoSource?: string;
}

export interface EvidenceViolationInput {
  violationCode: string | null;
  violationDescription: string | null;
  basicCategory: string | null;
  citationNumber: string | null;
  citationResult: string | null;
  challengeReason?: string | null;
}

function addUnique(
  items: EvidenceRequirement[],
  item: EvidenceRequirement
) {
  if (!items.some((existing) => existing.docType === item.docType)) {
    items.push(item);
  }
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasUnknownCitationDisposition(violation: EvidenceViolationInput) {
  if (!violation.citationNumber?.trim()) return false;
  const result = normalized(violation.citationResult);
  return !result || result === "unknown" || result === "pending" || result === "not provided" || result === "n/a";
}

function hasDuplicateSignal(violation: EvidenceViolationInput, challenge: ChallengeScore) {
  const text = [
    violation.violationCode,
    violation.violationDescription,
    violation.challengeReason,
    challenge.hypothesis,
    challenge.summary,
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("duplicate");
}

function hasRecordingErrorSignal(violation: EvidenceViolationInput, challenge: ChallengeScore) {
  const text = [
    violation.violationDescription,
    violation.challengeReason,
    challenge.hypothesis,
    challenge.summary,
  ].filter(Boolean).join(" ").toLowerCase();

  return ["mismatch", "clerical", "incorrect", "wrong", "recording error"].some((needle) =>
    text.includes(needle)
  );
}

export function evidenceRequirementsForViolation(
  violation: EvidenceViolationInput,
  challenge: ChallengeScore
): EvidenceRequirement[] {
  const items: EvidenceRequirement[] = [];
  const basic = normalized(violation.basicCategory);

  if (challenge.label === "not_challengeable" || challenge.label === "operational") {
    return items;
  }

  if (hasUnknownCitationDisposition(violation)) {
    addUnique(items, {
      docType: "court_disposition",
      label: `Court disposition for citation #${violation.citationNumber}`,
      neededReason:
        "A dismissed or reduced citation removes the violation from the record; carrier or driver usually holds this, with manual court lookup as fallback.",
      acquisitionMethod: "client",
    });
  }

  addUnique(items, {
    docType: "inspection_report",
    label: "Roadside inspection report",
    neededReason:
      "Confirms what was actually cited and may reveal a recording error.",
    acquisitionMethod: "auto",
    autoSource: "inspection_report",
  });

  if (hasDuplicateSignal(violation, challenge)) {
    addUnique(items, {
      docType: "duplicate_scan",
      label: "Duplicate-inspection check",
      neededReason: "A duplicate record can be removed.",
      acquisitionMethod: "auto",
      autoSource: "duplicate_scan",
    });
  }

  if (hasRecordingErrorSignal(violation, challenge)) {
    addUnique(items, {
      docType: "duplicate_scan",
      label: "Duplicate-inspection check",
      neededReason: "A duplicate or mismatched record can be removed if confirmed.",
      acquisitionMethod: "auto",
      autoSource: "duplicate_scan",
    });
  }

  if (basic === "unsafe_driving" || basic === "hos_compliance") {
    addUnique(items, {
      docType: "driver_statement",
      label: "Driver statement",
      neededReason:
        "Driver behavior and HOS disputes need the driver's account before deciding whether a DataQs filing is honest.",
      acquisitionMethod: "client",
    });
  }

  if (basic === "vehicle_maintenance") {
    addUnique(items, {
      docType: "maintenance_record",
      label: "Maintenance or repair record",
      neededReason:
        "Maintenance records can support a recording-error review, but ordinary repairs after inspection do not by themselves remove a valid violation.",
      acquisitionMethod: "client",
    });
  }

  if (basic === "driver_fitness") {
    addUnique(items, {
      docType: "dq_file_doc",
      label: "Driver qualification file document",
      neededReason:
        "Driver Fitness challenges need the qualification-file document that existed at the time of inspection.",
      acquisitionMethod: "client",
    });
  }

  return items;
}
