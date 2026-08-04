export const LANE_B_EVIDENCE_CLASSES = [
  "wrong-attribution",
  "duplicate",
  "citation-dismissed",
  "report-factual-error",
] as const;

export type LaneBEvidenceClass = (typeof LANE_B_EVIDENCE_CLASSES)[number];

export type LaneBEvidenceItem = {
  itemKey: string;
  label: string;
  contextNote: string;
};

export type LaneBEvidenceClassDefinition = {
  title: string;
  trigger: string;
  items: readonly Omit<LaneBEvidenceItem, "contextNote">[];
  ask: string;
};

export const LANE_B_EVIDENCE_TAXONOMY: Record<
  LaneBEvidenceClass,
  LaneBEvidenceClassDefinition
> = {
  "wrong-attribution": {
    title: "Records showing this violation belongs to someone else",
    trigger:
      "The review identifies the wrong carrier, driver, or vehicle as the likely record defect.",
    items: [
      { itemKey: "registration", label: "Vehicle registration" },
      { itemKey: "lease", label: "Lease or interchange agreement" },
      { itemKey: "driver-roster", label: "Driver roster for the inspection date" },
      { itemKey: "eld-gps", label: "ELD or GPS location records" },
    ],
    ask:
      "Please upload the records that show which carrier, driver, and vehicle were operating at the inspection time.",
  },
  duplicate: {
    title: "Records needed to confirm a duplicate",
    trigger:
      "The review identifies a duplicate inspection or violation as the specific defect.",
    items: [
      { itemKey: "vin", label: "VIN or unit record" },
      { itemKey: "inspection-time", label: "Inspection date and time record" },
      { itemKey: "authenticated-trip-data", label: "Authenticated ELD, GPS, or dispatch record" },
    ],
    ask:
      "Please upload the VIN and time-stamped carrier records that let us compare the two entries precisely.",
  },
  "citation-dismissed": {
    title: "Certified court disposition needed",
    trigger:
      "A citation exists and its final court disposition is favorable or still unknown.",
    items: [
      { itemKey: "certified-court-disposition", label: "Certified court disposition" },
    ],
    ask:
      "Please upload the certified court disposition showing the ticket's final result.",
  },
  "report-factual-error": {
    title: "Records needed to prove a report error",
    trigger:
      "The review identifies a specific factual, clerical, or recording error in the inspection report.",
    items: [
      { itemKey: "driver-copy", label: "Driver's copy of the inspection report" },
      { itemKey: "photos", label: "Dated photos from the inspection or repair" },
      { itemKey: "repair-invoices", label: "Repair invoices or work orders" },
    ],
    ask:
      "Please upload the driver's report copy and any dated photos or repair records that show the factual error.",
  },
};

export const CITATION_DISMISSED_INTAKE_QUESTION =
  "Has any driver fought and beaten a roadside ticket in the last 24 months?";

const SHORT_VIOLATION_DESCRIPTION_MAX = 72;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type LaneBEvidenceViolationContext = {
  violationCode?: string | null;
  violationDescription?: string | null;
  inspectionDate?: string | null;
};

function compactViolationDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= SHORT_VIOLATION_DESCRIPTION_MAX) return normalized;
  const clipped = normalized
    .slice(0, SHORT_VIOLATION_DESCRIPTION_MAX - 1)
    .trimEnd();
  const finalSpace = clipped.lastIndexOf(" ");
  const wordSafe =
    finalSpace >= Math.floor(SHORT_VIOLATION_DESCRIPTION_MAX * 0.6)
      ? clipped.slice(0, finalSpace)
      : clipped;
  return `${wordSafe}\u2026`;
}

function formatInspectionDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${MONTH_LABELS[month - 1]} ${day}, ${year}`;
}

/**
 * Deterministic client-facing violation context shared by new request creation
 * and the one-time live title backfill. Incomplete context stays generic rather
 * than inventing a code, description, or inspection date.
 */
export function formatLaneBEvidenceViolationContext(
  context: LaneBEvidenceViolationContext
) {
  const code = context.violationCode?.replace(/\s+/g, " ").trim() ?? "";
  const description = context.violationDescription
    ? compactViolationDescription(context.violationDescription)
    : "";
  const inspectionDate = context.inspectionDate
    ? formatInspectionDate(context.inspectionDate)
    : null;
  if (!code || !description || !inspectionDate) return null;
  return `${code} (${description}, ${inspectionDate})`;
}

export type LaneBViolationClassificationInput = {
  challengeTier: string | null;
  challengeReason: string | null;
  violationCode: string | null;
  violationDescription: string | null;
  citationNumber: string | null;
  citationResult: string | null;
};

const ACTIONABLE_TIERS = new Set(["strong", "moderate", "investigate"]);

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasAny(text: string, needles: readonly string[]) {
  return needles.some((needle) => text.includes(needle));
}

function hasAffirmativeSignal(text: string, signals: readonly string[]) {
  return signals.some((signal) => {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const index = text.indexOf(signal, searchFrom);
      if (index < 0) return false;
      const clauseStart = Math.max(
        text.lastIndexOf(".", index - 1),
        text.lastIndexOf(";", index - 1),
        text.lastIndexOf("!", index - 1),
        text.lastIndexOf("?", index - 1),
        index - 96
      );
      const prefix = text.slice(clauseStart + 1, index);
      const negated =
        /\b(?:no|not|without|lacks?|absent|neither)\b[^.;!?]{0,96}$/i.test(
          prefix
        );
      if (!negated) return true;
      searchFrom = index + signal.length;
    }
    return false;
  });
}

function citationDispositionNeedsEvidence(
  citationNumber: string | null,
  citationResult: string | null
) {
  const result = normalized(citationResult);
  const favorable = hasAny(result, [
    "dismiss",
    "not guilty",
    "no conviction",
    "reduced",
    "withdrawn",
  ]);
  const unknown =
    !result || ["unknown", "pending", "not provided", "n/a"].includes(result);
  return favorable || (Boolean(citationNumber?.trim()) && unknown);
}

/**
 * Deterministic routing only. The classifier still owns the challenge tier;
 * this function maps its record-specific reason to the locked evidence class.
 */
export function evidenceClassesForViolation(
  violation: LaneBViolationClassificationInput,
  options: { caseOpen?: boolean } = {}
): LaneBEvidenceClass[] {
  if (
    !options.caseOpen &&
    (!violation.challengeTier || !ACTIONABLE_TIERS.has(violation.challengeTier))
  ) {
    return [];
  }

  const reasonText = normalized(violation.challengeReason);
  const classes = new Set<LaneBEvidenceClass>();

  if (
    citationDispositionNeedsEvidence(
      violation.citationNumber,
      violation.citationResult
    ) ||
    hasAny(reasonText, [
      "court disposition",
      "citation result",
      "citation-based",
      "citation backed",
      "ticket disposition",
      "ticket's final result",
    ])
  ) {
    classes.add("citation-dismissed");
  }
  if (
    hasAffirmativeSignal(reasonText, [
      "duplicate",
      "duplicated",
      "same inspection twice",
    ])
  ) {
    classes.add("duplicate");
  }
  if (
    hasAffirmativeSignal(reasonText, [
      "wrong carrier",
      "wrong driver",
      "wrong vehicle",
      "wrong unit",
      "not our carrier",
      "not our driver",
      "not our vehicle",
      "not attributed",
      "misattributed",
      "attribution",
    ])
  ) {
    classes.add("wrong-attribution");
  }
  if (
    hasAffirmativeSignal(reasonText, [
      "factual error",
      "recording error",
      "clerical",
      "mismatch",
      "incorrect",
      "wrong description",
      "wrong code",
    ])
  ) {
    classes.add("report-factual-error");
  }

  // An actionable assessment or deliberately opened case must never disappear
  // into an untyped generic ask. A case-open fallback asks for factual proof;
  // it does not relabel the underlying challengeability assessment.
  if (classes.size === 0) classes.add("report-factual-error");

  return [...classes];
}

export function buildLaneBEvidenceRequestCopy(
  evidenceClass: LaneBEvidenceClass,
  potentialPoints: number,
  context: LaneBEvidenceViolationContext = {}
) {
  const definition = LANE_B_EVIDENCE_TAXONOMY[evidenceClass];
  const pointLabel = `${potentialPoints} ${
    potentialPoints === 1 ? "point" : "points"
  }`;
  const violationContext = formatLaneBEvidenceViolationContext(context);
  const contextualTitle =
    evidenceClass === "citation-dismissed"
      ? "Certified court disposition"
      : definition.title;
  const contextNote = `${definition.ask} If the records confirm the error, this could remove ${pointLabel}.`;

  return {
    title: violationContext
      ? `${contextualTitle} \u2014 ${violationContext}`
      : definition.title,
    whyCopy: `This could remove ${pointLabel} if the evidence confirms the issue.`,
    statusCopy: definition.ask,
    requestedItems: definition.items.map((item) => ({
      ...item,
      contextNote,
    })),
  };
}
