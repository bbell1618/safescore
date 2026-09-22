const WORK_LABELS: Record<string, string> = {
  a: "crash preventability review",
  b: "record correction",
  c: "operational safety improvement",
  i: "evidence investigation",
};

/** Presentation only: preserve stored records, identifiers, actions and numbers. */
export function portalCopy(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\bmcs150_truth_up\b/gi, "MCS-150 review")
    .replace(/\btotal_safety\b/gi, "Total Safety")
    .replace(/\btruth[\s-]?up\b/gi, "review")
    .replace(/\blane[\s_-]+([abci])\b/gi, (_, key: string) => WORK_LABELS[key.toLowerCase()])
    .replace(/\bnot_challengeable\b/gi, "not challengeable")
    .replace(/(?<!violation )\bburden\b/gi, "violation burden")
    .replace(/(?<![\d.-])(\d+(?:\.\d+)?)\s*(?:→|->)\s*\1(?![\d.])/g, "Unchanged at $1");
}
