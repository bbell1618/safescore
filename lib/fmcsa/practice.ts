/**
 * Practice copies of a real carrier store dot_number as "PR<real DOT>" so the
 * real carrier's unique DOT is untouched. Every FMCSA lookup goes through
 * fmcsaDot() so a practice copy reads the real carrier's public record.
 */
export const PRACTICE_DOT_PREFIX = "PR";

export function fmcsaDot(dotNumber: string): string {
  return dotNumber.startsWith(PRACTICE_DOT_PREFIX) ? dotNumber.slice(PRACTICE_DOT_PREFIX.length) : dotNumber;
}

export function practiceDot(realDot: string): string {
  return `${PRACTICE_DOT_PREFIX}${realDot}`;
}
