export const SENTINEL_INSUFFICIENT = 'INSUFFICIENT EVIDENCE';

/**
 * Precise regex for the [VERIFY: ...] placeholder token emitted by the AI when
 * a fact requires human confirmation before filing.
 *
 * Design notes:
 * - Requires the literal [ bracket — does NOT match the bare word "verification"
 *   or "verify" (e.g. "PAR Identity Verification:" does NOT trigger this).
 * - Case-insensitive so [verify:] or [Verify:] from any model variant also match.
 * - \b after VERIFY prevents partial matches like [VERIFYING:].
 * - [:\]] matches either [VERIFY:...] (placeholder with colon) or [VERIFY] (closed form).
 */
export const VERIFY_SENTINEL_RE = /\[\s*VERIFY\b[:\]]/i;

/**
 * Returns true if the narrative contains an unresolved [VERIFY: ...] placeholder.
 * Single source of truth — use this everywhere instead of inline includes() checks.
 */
export function hasVerifyPlaceholder(narrative: string | null | undefined): boolean {
  if (!narrative) return false;
  return VERIFY_SENTINEL_RE.test(narrative);
}

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
  if (hasVerifyPlaceholder(narrative)) {
    return 'Narrative contains unresolved [VERIFY: ...] placeholders. Resolve them before approving.';
  }
  return null; // null = approvable
}

export function isNarrativeApprovable(narrative: string | null | undefined): boolean {
  return narrativeBlockReason(narrative) === null;
}
