export const CHALLENGE_TIERS = [
  "strong",
  "moderate",
  "investigate",
  "not_challengeable",
  "operational",
] as const;

export type ChallengeTier = (typeof CHALLENGE_TIERS)[number];

export type ChallengeabilityAssessment = {
  tier: ChallengeTier;
  reason: string;
  specificDefect: string | null;
  evidence: string | null;
  evidenceSource: string | null;
  priority: "high" | "medium" | "low";
  confidence: number;
  suggestedApproach: string | null;
};

export type ChallengeabilityRecord = {
  violationCode: string;
  description: string;
  basicCategory: string;
  severityWeight: number;
  oosViolation: boolean;
  convicted: boolean | null;
  citationNumber: string | null;
  citationResult: string | null;
  inspectionDate: string;
  state: string;
  inspectionLevel: string;
};

export function challengeableForTier(tier: ChallengeTier): boolean {
  return tier === "strong" || tier === "moderate";
}

export function buildChallengeabilitySystemPrompt(today: string): string {
  return `You classify FMCSA roadside violations under SafeScore's evidence-driven five-tier rubric.

TODAY IS ${today}. Use this exact date for date comparisons.

The default is operational: the violation appears legitimate and belongs in Lane C for correction and 24-month age-out. The burden of proof is on moving away from that default. Never justify challenging by saying a violation type is often, frequently, potentially, or theoretically challengeable.

The five tiers are:
- strong: a proven data error with conclusive evidence already present in the supplied record, especially a dismissed, not-guilty, withdrawn, or reduced citation. DataQ-ready.
- moderate: a specific factual or administrative defect is proven by the supplied record, such as an internal code/description mismatch, impossible date relative to TODAY, duplicate, wrong carrier/driver/unit, or jurisdiction mismatch. DataQ-ready only with the named evidence.
- investigate: one specific, checkable hypothesis exists, but proof is absent. Name exactly what evidence would confirm or disprove it and who supplies that evidence. Not removable and not filable.
- not_challengeable: supplied facts affirmatively defeat a DataQ path, such as an upheld or guilty disposition with no separate record defect. Lane C.
- operational: no record-specific defect is proven. Treat the violation as legitimate and address it operationally while it ages out. Lane C.

Ground rules:
1. Use only these supplied fields: code, description, BASIC category, severity weight, OOS flag, convicted value, citation number, citation result, inspection date, inspection level, and state.
2. Do not assert regulatory, inspection-procedure, officer-practice, or court facts that are not in the supplied record. If uncertain, say unknown and choose operational or investigate.
3. Speculation is not a ground. Phrases such as "frequently challengeable", "may be viable if", "dispute the officer's subjective assessment", and generic lists of things that could be wrong are forbidden.
4. Every strong or moderate result must name the specific defect in this record, the evidence that proves it, and the evidence source. No proof named means it is not strong or moderate.
5. Every investigate result must name one specific hypothesis, the exact evidence needed to confirm or kill it, and who supplies it. No evidence and source named means operational.
6. citation_result is load-bearing. A favorable result is the strongest DataQ ground. If convicted=true and the record is citation-based because it has a citation number OR its code/description explicitly identifies a state/local-law violation, a blank citation_result is investigate: obtain the court disposition from the issuing court or jurisdiction. It is not a data error. For other records, a legacy convicted=true value without a citation number does not prove that a citation exists.
7. A blank or absent field is unknown, not evidence of an error.
8. Severity and weighted-point impact affect priority only. They never make a violation challengeable.
9. suggestedApproach must be null for not_challengeable and operational. Do not put coaching or maintenance advice in that field.
10. Return only JSON matching the requested structure.`;
}

const SPECULATIVE_PHRASES = [
  "frequently challengeable",
  "may be viable if",
  "disputing the officer's subjective assessment",
  "dispute the officer's subjective assessment",
];

export function validateChallengeabilityAssessment(
  assessment: ChallengeabilityAssessment,
  record: ChallengeabilityRecord,
  today: string
): void {
  const combined = [assessment.reason, assessment.specificDefect, assessment.evidence]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const speculative = SPECULATIVE_PHRASES.find((phrase) => combined.includes(phrase));
  if (speculative) throw new Error(`Speculative challenge language is not allowed: ${speculative}`);

  if (challengeableForTier(assessment.tier)) {
    if (!assessment.specificDefect || !assessment.evidence || !assessment.evidenceSource) {
      throw new Error(`${assessment.tier} requires a specific defect, proving evidence, and evidence source`);
    }
  }

  if (assessment.tier === "investigate") {
    if (!assessment.specificDefect || !assessment.evidence || !assessment.evidenceSource) {
      throw new Error("investigate requires one hypothesis, exact evidence needed, and its source");
    }
  }

  const citationBased = Boolean(record.citationNumber?.trim()) ||
    record.violationCode.toLowerCase().includes("sll") ||
    record.description.toLowerCase().includes("state/local");
  if (
    record.convicted === true &&
    citationBased &&
    !record.citationResult?.trim() &&
    assessment.tier !== "investigate"
  ) {
    throw new Error("citation-based conviction with no disposition must be investigate");
  }

  if (assessment.tier === "strong") {
    const disposition = record.citationResult?.trim().toLowerCase() ?? "";
    const favorable = ["dismiss", "not guilty", "no conviction", "reduced", "withdrawn"]
      .some((value) => disposition.includes(value));
    if (!favorable) throw new Error("strong requires a favorable citation disposition in the supplied record");
  }

  if (
    (assessment.tier === "not_challengeable" || assessment.tier === "operational") &&
    assessment.suggestedApproach
  ) {
    throw new Error(`${assessment.tier} cannot include a DataQ or evidence-collection approach`);
  }

  if (combined.includes("future date") && record.inspectionDate <= today) {
    throw new Error(`Past inspection date ${record.inspectionDate} cannot be described as a future date`);
  }

  if (
    record.violationCode === "39216AD" &&
    record.inspectionLevel === "3" &&
    (combined.includes("driver not present") || combined.includes("without the driver present"))
  ) {
    throw new Error("Level 3 assessment invented that the driver was not present");
  }
}
