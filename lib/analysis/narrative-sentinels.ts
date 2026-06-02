export const SENTINEL_VERIFY = '[VERIFY:';
export const SENTINEL_INSUFFICIENT = 'INSUFFICIENT EVIDENCE';

/**
 * Returns a human-readable block reason if the narrative cannot be approved,
 * or null if the narrative is approvable.
 * Used server-side (route handlers) and client-side (workbench UI).
 */
export function narrativeBlockReason(narrative: string | null | undefined): string | null {
  if (!narrative) return null;
  if (narrative.includes(SENTINEL_INSUFFICIENT)) {
    return 'The AI determined the attached evidence does not support this challenge. Obtain proper evidence and regenerate before approving.';
  }
  if (narrative.includes(SENTINEL_VERIFY)) {
    return 'Narrative contains unresolved [VERIFY: ...] placeholders. Resolve them before approving.';
  }
  return null; // null = approvable
}

export function isNarrativeApprovable(narrative: string | null | undefined): boolean {
  return narrativeBlockReason(narrative) === null;
}
