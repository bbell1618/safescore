export interface FilingReady {
  text: string;
  blocked: boolean;
  blockReason: string | null;
}

const VERIFY_RE = /\[\s*VERIFY\s*:[^\]]+\]/i;
const METADATA_RE =
  /^\s*(case|dot|usdot|crash|report|prepared|date|client|re|subject|internal|prepared by)\s*:/i;
const REVIEWER_NOTE_RE =
  /^\s*(note for (the )?human reviewer|reviewer note|internal note|note to reviewer)\b/i;
const IDENTITY_META_RE =
  /document identity|reconcil|identity verification|confirm(ing|ed)?\b[^.]*\bby (the )?(us)?dot( number)?,? (the )?date,? and (the )?location/i;

export function hasUnresolvedVerify(text: string): boolean {
  return VERIFY_RE.test(text);
}

export function toFilingReadyNarrative(raw: string | null | undefined): FilingReady {
  if (!raw || raw.replace(/\s/g, "").length < 10) {
    return { text: "", blocked: true, blockReason: "No narrative to file." };
  }

  if (/INSUFFICIENT EVIDENCE/i.test(raw)) {
    return {
      text: "",
      blocked: true,
      blockReason: "Narrative is flagged insufficient - obtain proper evidence and regenerate.",
    };
  }

  if (hasUnresolvedVerify(raw)) {
    return {
      text: "",
      blocked: true,
      blockReason: "Resolve the [VERIFY: ...] placeholder(s) before filing.",
    };
  }

  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  while (lines.length > 0 && METADATA_RE.test(lines[0])) {
    lines.shift();
  }

  const reviewerNoteIndex = lines.findIndex((line) => REVIEWER_NOTE_RE.test(line));
  const withoutReviewerNotes =
    reviewerNoteIndex === -1 ? lines : lines.slice(0, reviewerNoteIndex);

  const cleaned = withoutReviewerNotes
    .filter((line) => !IDENTITY_META_RE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // The operator reviews this cleaned output before pasting it into DataQs.
  return { text: cleaned, blocked: false, blockReason: null };
}
