/**
 * OpenRouter AI client using the OpenAI SDK
 * Model: anthropic/claude-sonnet-4-6
 */

import OpenAI from "openai";

const MODEL = "anthropic/claude-sonnet-4-6";
const NARRATIVE_MODEL = "anthropic/claude-opus-4.8";
export const NARRATIVE_MODEL_SLUG = NARRATIVE_MODEL;

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://safescore.app",
      "X-Title": "Golden Era SafeScore",
    },
  });
}

export interface EvidenceFile {
  label: string;
  mimeType: string;           // 'application/pdf', 'image/jpeg', etc.
  base64Data: string;         // base64 encoded file contents
  sizeBytes: number;
}

export interface ChallengeabilityResult {
  challengeable: boolean;
  reason: string;
  priority: "high" | "medium" | "low";
  confidence: number; // 0-100
  suggestedApproach: string | null;
}

export interface CpdpEligibilityResult {
  eligible: boolean;
  eligibleTypes: string[];
  confidence: number;
  reasoning: string;
  verdict?: 'ELIGIBLE' | 'INDETERMINATE' | 'NOT_ELIGIBLE';
}

export interface DenialAnalysisResult {
  worthReconsidering: boolean;
  reasoning: string;
  suggestedArgument: string | null;
}

export async function assessViolationChallengeability(
  violation: {
    violationCode: string;
    description: string;
    basicCategory: string;
    severityWeight: number;
    oosViolation: boolean;
    convicted: boolean;
    inspectionDate: string;
    state: string;
    inspectionLevel: string;
  }
): Promise<ChallengeabilityResult> {
  const client = getClient();

  const prompt = `You are an expert in FMCSA DataQs violation challenges. Assess whether this violation is challengeable.

Violation details:
- Code: ${violation.violationCode}
- Description: ${violation.description}
- BASIC Category: ${violation.basicCategory}
- Severity Weight: ${violation.severityWeight}
- OOS Violation: ${violation.oosViolation}
- Conviction recorded: ${violation.convicted}
- Inspection Date: ${violation.inspectionDate}
- State: ${violation.state}
- Inspection Level: ${violation.inspectionLevel}

Respond in JSON with this exact structure:
{
  "challengeable": boolean,
  "reason": "concise reason why it is or isn't challengeable",
  "priority": "high" | "medium" | "low",
  "confidence": number (0-100),
  "suggestedApproach": "brief description of challenge approach" | null
}

Common grounds for challenge: incorrect violation code, violation not observed, equipment was repaired before OOS designation, missing procedural requirements, officer lacked authority, incorrect carrier assignment. High priority = high severity weight + likely challengeable. Not challengeable = clear cut violation with no procedural errors.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI");

  return JSON.parse(content) as ChallengeabilityResult;
}

// Expanded 21-type list for crashes on/after 2024-12-01 (mirrors the editor constant)
const CPDP_TYPES_EXPANDED = [
  "Struck in the rear by another vehicle",
  "Struck while legally stopped or parked",
  "Wrong-direction or illegal U-turn by another vehicle",
  "Struck by an impaired driver",
  "Struck by a distracted driver",
  "Struck by a vehicle changing lanes",
  "Failure to stop at traffic control device by another vehicle",
  "Other driver fell asleep or had a medical emergency",
  "Animal strike",
  "Cargo or debris from another vehicle",
  "Infrastructure failure (road, bridge, or signal defect)",
  "Other vehicle mechanical failure",
  "Suicide attempt by another person",
  "Weather event or natural disaster",
  "Struck in a work zone (not carrier's negligence)",
  "Struck by a train or railroad equipment",
  "Rail crossing signal or gate failure",
  "Vehicle ahead stopped or turned unexpectedly",
  "Struck while loading or unloading",
  "Struck by a vehicle crossing the median",
  "Other — crash circumstances beyond the carrier's control",
];

const CPDP_TYPES_LEGACY = [
  "Struck in the rear",
  "Parked or legally stopped vehicle struck",
  "Wrong-direction or illegal turn by other vehicle",
  "Other vehicle failure to yield",
  "Lane change by other vehicle",
  "Other driver fell asleep or was incapacitated",
  "Animal strike",
  "Infrastructure failure",
  "Other — not preventable",
];

export async function assessCpdpEligibility(
  crash: {
    crashDate: string;
    state: string;
    fatalities: number;
    injuries: number;
    towAway: boolean;
    hazmatRelease: boolean;
    description: string;
  },
  evidenceFiles?: EvidenceFile[]
): Promise<CpdpEligibilityResult> {
  const client = getClient();

  const hasFiles = (evidenceFiles ?? []).filter(f => f.sizeBytes > 0).length > 0;
  const useExpanded = crash.crashDate >= '2024-12-01';
  const typeList = useExpanded ? CPDP_TYPES_EXPANDED : CPDP_TYPES_LEGACY;
  const typeListText = typeList.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const model = hasFiles ? NARRATIVE_MODEL : MODEL;

  const prompt = `You are an FMCSA CPDP (Crash Preventability Determination Program) eligibility assessor.${hasFiles ? ' A Police Accident Report (PAR) is attached. Read it carefully before responding.' : ''}

TASK: Assess whether this crash qualifies for a CPDP submission.

CRASH METADATA:
- Date: ${crash.crashDate}
- State: ${crash.state}
- Fatalities: ${crash.fatalities}
- Injuries: ${crash.injuries}
- Tow-away: ${crash.towAway}
- Hazmat release: ${crash.hazmatRelease}
- Description: ${crash.description}

ELIGIBLE CRASH TYPES FOR THIS DATE (${useExpanded ? '21-type list, Dec 2024+' : '9-type legacy list'}):
${typeListText}

GROUNDING RULES:
${hasFiles
  ? `- Read the attached PAR before concluding.
- Only identify eligible types that the PAR directly supports.
- If the PAR shows the CMV driver was at fault (cited, made an unsafe maneuver, failed to stop/yield), set verdict to "NOT_ELIGIBLE".
- If the PAR is ambiguous, illegible, or shows conflicting fault attribution, set verdict to "INDETERMINATE".
- Never identify a crash type that the PAR does not support.`
  : `- Assessment is based on crash metadata only — no document attached.
- Be conservative: return INDETERMINATE if fault is unclear from metadata alone.`}

Respond with valid JSON only (no markdown, no code blocks):
{
  "eligible": boolean,
  "eligibleTypes": ["exact strings from the numbered type list above, or empty array"],
  "confidence": number_0_to_100,
  "reasoning": "concise grounded explanation, citing PAR fields if available",
  "verdict": "ELIGIBLE" or "INDETERMINATE" or "NOT_ELIGIBLE"
}`;

  if (hasFiles) {
    // Opus 4.8 path — file content blocks + grounded assessment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentParts: any[] = [];
    for (const ef of evidenceFiles ?? []) {
      if (ef.sizeBytes > 8388608) {
        console.warn('[assessCpdpEligibility] Skipping oversized file:', ef.label, ef.sizeBytes, 'bytes');
        continue;
      }
      if (ef.mimeType === 'application/pdf') {
        contentParts.push({
          type: 'file',
          file: {
            filename: ef.label.replace(/[^a-z0-9_.-]/gi, '_') + '.pdf',
            file_data: `data:application/pdf;base64,${ef.base64Data}`,
          },
        });
      } else if (ef.mimeType.startsWith('image/')) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${ef.mimeType};base64,${ef.base64Data}` },
        });
      }
    }
    contentParts.push({ type: 'text', text: prompt });

    const partTypes = contentParts.map(p =>
      p.type === 'file' ? 'file(pdf)' : p.type === 'image_url' ? 'image_url' : p.type
    );
    console.log('[assessCpdpEligibility] Content parts:', partTypes, '| model:', model);

    const messageContent = contentParts.length === 1 ? prompt : contentParts;
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: messageContent }],
        temperature: 0.1,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No response from AI');
      // Strip markdown code fences if the model wraps the JSON
      const clean = content.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      return JSON.parse(clean) as CpdpEligibilityResult;
    } catch (err) {
      console.error(
        '[assessCpdpEligibility] OpenRouter API call failed:',
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  } else {
    // Sonnet text-only path — metadata assessment without a document
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from AI');
    return JSON.parse(content) as CpdpEligibilityResult;
  }
}

export async function draftDataqNarrative(params: {
  violationCode: string;
  violationDescription: string;
  inspectionDate: string;
  state: string;
  inspectionLevel: string;
  facilityName: string;
  challengeReason: string;
  suggestedApproach: string;
  carrierName: string;
  dotNumber: string;
  additionalContext?: string;
  evidenceItems?: Array<{ label: string; fmcsa_category: string; status: 'requested' | 'received' }>;
  isProvisional?: boolean;
  evidenceFiles?: EvidenceFile[];
}): Promise<string> {
  const client = getClient();

  const receivedItems = params.evidenceItems?.filter(e => e.status === 'received') ?? [];
  const receivedSummary = receivedItems.length > 0
    ? "Attached evidence: " + receivedItems.map(e => e.label + (e.fmcsa_category ? " (" + e.fmcsa_category + ")" : "")).join(", ")
    : "No evidence received yet.";

  const prompt = `You are drafting a DataQs Request for Data Review (RDR) submission for a trucking carrier.
You will be given the structured case data and the actual evidence documents.

ROLE AND AUTHORITY:
- You are a technical compliance specialist, not a legal advocate.
- You may only assert facts that you can directly verify from the provided documents or the structured case data below.
- DO NOT speculate, infer, or fabricate ANY factual claim not supported by the documents.
- If a document does not clearly support a specific claim, mark that claim with [VERIFY: <what needs human confirmation>] and do NOT state it as fact.
- If the provided documents do NOT support the challenge (wrong document type, illegible, unrelated content, or clearly from a different date), state clearly: "The attached documents do not appear to directly support this challenge. The case should not be filed until appropriate evidence is obtained." Do not write a challenge narrative in that case.

CASE DATA:
Carrier: ${params.carrierName} (DOT ${params.dotNumber})
Violation: ${params.violationCode} — ${params.violationDescription}
Inspection date (use EXACTLY this date — do not change or approximate it): ${params.inspectionDate}
Inspection location: ${params.facilityName}, ${params.state} — Level ${params.inspectionLevel}
Challenge basis: ${params.challengeReason}
${receivedSummary}

GROUNDING INSTRUCTIONS:
Read the attached document(s) carefully before writing. The narrative must:
1. Cite the controlling CFR section relevant to this violation
2. Reference specific, verifiable facts from the attached documents (e.g. exact times, totals, form fields visible in the document)
3. Use ONLY the inspection date above — do not use any other date
4. If no evidence is attached or documents are insufficient: write "INSUFFICIENT EVIDENCE: [reason]" as the first line and do not write a narrative
5. Maintain a professional, factual tone — no legal opinions or guarantees

EVIDENCE STATUS: ${params.isProvisional ? "PROVISIONAL — no evidence received yet; write a placeholder narrative only, prefixed with PROVISIONAL DRAFT:" : (params.evidenceFiles ?? []).filter(f => f.sizeBytes > 0).length > 0 ? "FINAL — evidence file(s) attached above for your review" : "EVIDENCE STATUS: No files could be loaded for attachment. Treat as provisional and mark uncertain claims [VERIFY: ...]"}

Write the 2-4 paragraph RDR narrative now. Every factual assertion must be traceable to the documents above.${params.additionalContext ? `\n\nAdditional context: ${params.additionalContext}` : ""}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentParts: any[] = [];
  for (const ef of params.evidenceFiles ?? []) {
    if (ef.sizeBytes > 8388608) {
      console.warn('[draftDataqNarrative] Skipping oversized file:', ef.label, ef.sizeBytes, 'bytes');
      continue;
    }
    if (ef.mimeType === 'application/pdf') {
      // Use OpenRouter "file" block format — the Anthropic-native "document" type is not valid
      // on the OpenAI-compatible endpoint and is rejected. OpenRouter accepts type:"file" with
      // file_data as a base64 data URI for PDF transmission to Claude models.
      contentParts.push({
        type: 'file',
        file: {
          filename: ef.label.replace(/[^a-z0-9_.-]/gi, '_') + '.pdf',
          file_data: `data:application/pdf;base64,${ef.base64Data}`,
        },
      });
    } else if (ef.mimeType.startsWith('image/')) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${ef.mimeType};base64,${ef.base64Data}` },
      });
    }
  }
  contentParts.push({ type: 'text', text: prompt });

  // Log exactly what is being sent to the model
  const partTypes = contentParts.map((p) => {
    if (p.type === 'file') return 'file(pdf)';
    if (p.type === 'document') return 'document(pdf)';
    if (p.type === 'image_url') return 'image_url';
    if (p.type === 'image') return 'image';
    if (p.type === 'text') return 'text';
    return p.type;
  });
  console.log('[draftDataqNarrative] Content parts:', partTypes, '| model:', NARRATIVE_MODEL);

  const messageContent = contentParts.length === 1 ? prompt : contentParts;

  try {
    const response = await client.chat.completions.create({
      model: NARRATIVE_MODEL,
      messages: [{ role: 'user', content: messageContent }],
      temperature: 0.2,
    });
    return response.choices[0]?.message?.content || "";
  } catch (err) {
    console.error(
      "[draftDataqNarrative] OpenRouter API call failed:",
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}

export async function draftCpdpNarrative(params: {
  crashDate: string;
  state: string;
  city: string;
  reportNumber?: string;
  fatalities: number;
  injuries: number;
  towAway: boolean;
  hazmatRelease: boolean;
  eligibleTypes: string[];
  carrierName: string;
  dotNumber: string;
  isProvisional?: boolean;
  evidenceFiles?: EvidenceFile[];
}): Promise<string> {
  const client = getClient();

  const eligibleSummary = params.eligibleTypes.length > 0
    ? params.eligibleTypes.join("; ")
    : "Not yet classified — assess from the PAR";

  const crashSummary = [
    params.towAway && "tow-away",
    params.fatalities > 0 && `${params.fatalities} fatal`,
    params.injuries > 0 && `${params.injuries} injured`,
    params.hazmatRelease && "hazmat release",
  ].filter(Boolean).join(", ") || "property damage only";

  const prompt = `You are drafting a CPDP (Crash Preventability Determination Program) Request for Determination (RFD) submission to FMCSA on behalf of a motor carrier.

ROLE AND AUTHORITY:
- You are a technical compliance specialist, not a legal advocate.
- You may ONLY assert facts that are directly verifiable from the attached Police Accident Report (PAR) or the structured case data below.
- DO NOT speculate, infer, or fabricate ANY factual claim not supported by the documents.
- If a fact is not clearly stated in the PAR, mark it: [VERIFY: <what needs human confirmation>]
- If the PAR does NOT support a non-preventable finding (wrong document, illegible, unrelated crash, or the carrier's driver appears to be at fault), write as the FIRST line: "INSUFFICIENT EVIDENCE: [reason]" — do not write a full narrative.

CASE DATA:
Carrier: ${params.carrierName} (DOT ${params.dotNumber})
Crash date (use EXACTLY this date): ${params.crashDate}
Location: ${params.city}, ${params.state}
Report number: ${params.reportNumber ?? "see attached PAR"}
Crash severity: ${crashSummary}
Asserted eligible CPDP type(s): ${eligibleSummary}

GROUNDING INSTRUCTIONS:
Read the attached PAR carefully before writing. The narrative must:
1. State the crash date, location, and report number from the PAR
2. Describe the crash sequence of events ONLY as documented in the PAR — cite specific fields (e.g., "Officer narrative states...", "Diagram shows...")
3. Identify the applicable CPDP-eligible crash type from 49 CFR Appendix B to Subchapter B
4. Explain why the carrier's driver could not have reasonably avoided the crash, grounded in PAR facts
5. Reference any independent contributing factors (other driver behavior, road conditions, signals) as documented in the PAR
6. Close with a clear request for a "Not Preventable" determination
7. Professional tone, 2-4 paragraphs, no legal opinions or guarantees

EVIDENCE STATUS: ${params.isProvisional
    ? "PROVISIONAL — no PAR attached yet. Write a placeholder narrative only, prefixed with: PROVISIONAL DRAFT:"
    : (params.evidenceFiles ?? []).filter(f => f.sizeBytes > 0).length > 0
      ? "FINAL — PAR and/or supporting documents attached above. Ground every assertion in the documents."
      : "No files could be loaded. Treat as provisional and mark uncertain claims [VERIFY: ...]"}

Write the RFD narrative now.`;

  // Build content parts — PDF files first, then prompt text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentParts: any[] = [];
  for (const ef of params.evidenceFiles ?? []) {
    if (ef.sizeBytes > 8388608) {
      console.warn('[draftCpdpNarrative] Skipping oversized file:', ef.label, ef.sizeBytes, 'bytes');
      continue;
    }
    if (ef.mimeType === 'application/pdf') {
      contentParts.push({
        type: 'file',
        file: {
          filename: ef.label.replace(/[^a-z0-9_.-]/gi, '_') + '.pdf',
          file_data: `data:application/pdf;base64,${ef.base64Data}`,
        },
      });
    } else if (ef.mimeType.startsWith('image/')) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${ef.mimeType};base64,${ef.base64Data}` },
      });
    }
  }
  contentParts.push({ type: 'text', text: prompt });

  const partTypes = contentParts.map((p) => {
    if (p.type === 'file') return 'file(pdf)';
    if (p.type === 'image_url') return 'image_url';
    if (p.type === 'text') return 'text';
    return p.type;
  });
  console.log('[draftCpdpNarrative] Content parts:', partTypes, '| model:', NARRATIVE_MODEL);

  const messageContent = contentParts.length === 1 ? prompt : contentParts;

  try {
    const response = await client.chat.completions.create({
      model: NARRATIVE_MODEL,
      messages: [{ role: 'user', content: messageContent }],
      temperature: 0.2,
    });
    return response.choices[0]?.message?.content || "";
  } catch (err) {
    console.error(
      "[draftCpdpNarrative] OpenRouter API call failed:",
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}

export async function generateAssessmentReport(params: {
  carrierName: string;
  dotNumber: string;
  fleetSize: number;
  driverCount: number;
  basics: Record<string, { measureValue: number; percentile: number | null; alert: boolean } | null>;
  oosRates: { vehicleOosRate: number | null; driverOosRate: number | null; hazmatOosRate: number | null };
  totalViolations: number;
  challengeableViolations: number;
  totalCrashes: number;
  cpdpEligibleCrashes: number;
  topActionItems: string[];
  estimatedPremiumImpact: string;
}): Promise<string> {
  const client = getClient();

  const basicsText = Object.entries(params.basics)
    .map(([name, data]) => {
      if (!data) return null;
      const alert = data.alert ? " ALERT" : "";
      const pct = data.percentile != null ? ` (${data.percentile}th percentile)` : "";
      return `- ${name}: ${data.measureValue.toFixed(1)}${pct}${alert}`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `Write a plain-English SafeScore assessment report for a trucking carrier. This report will be sent to the carrier as their initial analysis.

Carrier: ${params.carrierName} (DOT ${params.dotNumber})
Fleet: ${params.fleetSize} power units, ${params.driverCount} drivers
BASIC Scores:
${basicsText}
OOS Rates: Vehicle ${params.oosRates.vehicleOosRate}%, Driver ${params.oosRates.driverOosRate}%, Hazmat ${params.oosRates.hazmatOosRate ?? "N/A"}%
Violations: ${params.totalViolations} total, ${params.challengeableViolations} potentially challengeable
Crashes: ${params.totalCrashes} total, ${params.cpdpEligibleCrashes} potentially eligible for CPDP
Top recommended actions: ${params.topActionItems.join(", ")}
Estimated premium impact context: ${params.estimatedPremiumImpact}

Write a 4-6 paragraph assessment report that:
1. Opens with a clear summary of the carrier's current safety standing
2. Highlights the areas of greatest concern and opportunity
3. Explains in plain language what the numbers mean for their insurance and operations
4. Summarizes the remediation opportunities we identified
5. Closes with what we recommend as the next steps

Tone: Professional but accessible. Avoid government jargon. Write for a small fleet owner, not a compliance attorney.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || "";
}

export async function analyzeDenial(params: {
  violationCode: string;
  violationDescription: string;
  originalChallenge: string;
  denialReason: string;
}): Promise<DenialAnalysisResult> {
  const client = getClient();

  const prompt = `A DataQs challenge was denied. Assess whether reconsideration is worth pursuing.

Violation: ${params.violationCode} — ${params.violationDescription}
Original challenge: ${params.originalChallenge}
Denial reason: ${params.denialReason}

Respond in JSON:
{
  "worthReconsidering": boolean,
  "reasoning": "explanation of whether reconsideration has merit",
  "suggestedArgument": "specific argument to make in reconsideration, or null if not worth it"
}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI");

  return JSON.parse(content) as DenialAnalysisResult;
}
