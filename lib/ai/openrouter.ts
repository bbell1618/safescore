/**
 * OpenRouter AI client using the OpenAI SDK
 * Model: anthropic/claude-sonnet-4-6
 */

import OpenAI from "openai";

const MODEL = "anthropic/claude-sonnet-4-6";

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
}): Promise<string> {
  const client = getClient();

  const prompt = `You are drafting a DataQs Request for Data Review (RDR) submission for a trucking carrier. Write a professional, factual challenge narrative.

Carrier: ${params.carrierName} (DOT ${params.dotNumber})
Violation: ${params.violationCode} — ${params.violationDescription}
Inspection: ${params.inspectionDate}, ${params.facilityName}, ${params.state}, ${params.inspectionLevel}
Challenge basis: ${params.challengeReason}
Suggested approach: ${params.suggestedApproach}
${params.additionalContext ? `Additional context: ${params.additionalContext}` : ""}

Write a 2-4 paragraph RDR narrative that:
1. Clearly identifies the specific violation being challenged
2. States the factual basis for the challenge
3. References any regulatory citations if applicable
4. Requests the specific correction or removal
5. Maintains a professional, factual tone throughout

Do not include legal opinions or guarantees. Stick to facts and regulatory references.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content || "";
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
      const alert = data.alert ? " ⚠ ALERT" : "";
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
