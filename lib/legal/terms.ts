import { createHash } from "node:crypto";
import { TERMS_MARKDOWN } from "./terms-text";
import { FILING_AUTHORIZATION_WORDING, SERVICE_AGREEMENT_WORDING } from "./wording";

export const TERMS_DOCUMENT = "safescore_terms";

export type TermsSection = { title: string; paragraphs: string[] };

export const TERMS_SECTIONS: TermsSection[] = TERMS_MARKDOWN.replaceAll("\r\n", "\n")
  .split(/^## /m)
  .slice(1)
  .map((section) => {
    const [title, ...body] = section.trim().split("\n");
    return { title, paragraphs: body.join("\n").trim().split(/\n\s*\n/) };
  });

/**
 * Fingerprint of everything the owner approves: the terms and both sign-card
 * statements. An approval only counts while this matches.
 */
export const TERMS_HASH = createHash("sha256")
  .update(JSON.stringify([TERMS_SECTIONS, SERVICE_AGREEMENT_WORDING, FILING_AUTHORIZATION_WORDING]))
  .digest("hex");

export type TermsApproval = { name: string; approvedAt: string };
