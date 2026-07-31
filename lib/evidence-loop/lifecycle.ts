export type LaneBEvidenceStatus =
  | "open"
  | "submitted"
  | "applied"
  | "insufficient";

const TIER_STRENGTH: Record<string, number> = {
  not_challengeable: 0,
  operational: 0,
  investigate: 1,
  moderate: 2,
  strong: 3,
};

export type LaneBEvidenceOutcome = {
  evidenceStatus: "applied" | "insufficient" | null;
  strengthened: boolean;
  statusCopy: string | null;
};

export function laneBEvidenceOutcome(
  beforeTier: string | null,
  afterTier: string | null,
  analysisDecision: "supported" | "insufficient" | "failed"
): LaneBEvidenceOutcome {
  if (analysisDecision === "failed") {
    return { evidenceStatus: null, strengthened: false, statusCopy: null };
  }

  const challengeable = afterTier === "strong" || afterTier === "moderate";
  if (analysisDecision === "supported" && !challengeable) {
    return { evidenceStatus: null, strengthened: false, statusCopy: null };
  }

  const strengthened = Boolean(
    challengeable &&
      (TIER_STRENGTH[afterTier ?? ""] ?? -1) >
        (beforeTier ? TIER_STRENGTH[beforeTier] ?? -1 : -1)
  );
  return {
    evidenceStatus:
      analysisDecision === "supported" ? "applied" : "insufficient",
    strengthened,
    statusCopy: analysisDecision === "supported"
      ? strengthened
        ? "Evidence received — this strengthened your challenge."
        : "Evidence applied — this challenge remains supported."
      : "Evidence received — it did not establish a challenge yet. You can upload clearer records.",
  };
}

export function remainingLaneBEvidenceItems(
  requestedItems: readonly { itemKey: string }[],
  uploadedItemKeys: Iterable<string>
) {
  const uploaded = new Set(uploadedItemKeys);
  return requestedItems.filter((item) => !uploaded.has(item.itemKey)).length;
}

export function laneBIntakeAnswerOutcome(answer: "yes" | "no") {
  return {
    clientValue: answer === "yes",
    needsFollowup: answer === "yes",
    statusCopy:
      answer === "yes"
        ? "Answer recorded — your certified court-disposition request is ready."
        : "Answer recorded — no court-disposition follow-up is needed.",
  };
}

/**
 * The old consolidated case request and the typed U10 request may coexist.
 * Suppress only the exact legacy slot covered by an active typed ask; never
 * hide every case document because one typed request happens to link the case.
 */
export function laneBItemCoversLegacyEvidence(
  legacyDocType: string,
  typedItemKeys: ReadonlySet<string>
) {
  const coveredByDocType: Record<string, readonly string[]> = {
    court_disposition: ["certified-court-disposition"],
    maintenance_record: ["repair-invoices"],
  };
  return (coveredByDocType[legacyDocType] ?? []).some((itemKey) =>
    typedItemKeys.has(itemKey)
  );
}
