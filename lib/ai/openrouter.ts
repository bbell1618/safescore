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

export async function assessCpdpEligibility(
  crash: {
    crashDate: string;
    state: string;
    fatalities: number;
    injuries: number;
    towAway: boolean;
    hazmatRelease: boolean;
    description: string;
  }
): Promise<CpdpEligibilityResult> {
  const client = getClient();

  const prompt = `You are an expert in FMCSA Crash Preventability Determination Program (CPDP). Assess whether this crash is eligible for a CPDP submission.

Crash details:
- Date: ${crash.crashDate}
- State: ${crash.state}
- Fatalities: ${crash.fatalities}
- Injuries: ${crash.injuries}
- Tow-away: ${crash.towAway}
- Hazmat release: ${crash.hazmatRelease}
- Description: ${crash.description}

CPDP eligible crash types include: struck in rear, wrong direction/illegal turn by other vehicle, parked/legally stopped vehicle struck, failure to stop at traffic signal by other, lane-change collision caused by other, other driver fell asleep, vehicle running red light, medical emergency in another vehicle, and others specified in 49 CFR.

Respond in JSON:
{
  "eligible": boolean,
  "eligibleTypes": ["list of applicable eligible crash type categories"],
  "confidence": number (0-100),
  "reasoning": "explanation"
}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI");

  return JSON.parse(content) as CpdpEligibilityResult;
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
  description: string;
  eligibleTypes: string[];
  carrierName: string;
  dotNumber: string;
}): Promise<string> {
  const client = getClient();

  const prompt = `Draft a CPDP (Crash Preventability Determination Program) submission narrative for FMCSA.

Carrier: ${params.carrierName} (DOT ${params.dotNumber})
Crash: ${params.crashDate}, ${params.city}, ${params.state}
Description: ${params.description}
Eligible crash types: ${params.eligibleTypes.join(", ")}

Write a 2-3 paragraph narrative that:
1. Describes the crash circumstances factually
2. Explains why the crash was not preventable by the carrier
3. References the applicable CPDP eligible crash type(s)
4. Requests a "Not Preventable" determination

Professional tone, factual, no legal opinions.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content || "";
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
