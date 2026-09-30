import "server-only";
import OpenAI from "openai";
import type { CarrierFacts, FamilyFact } from "./facts";

/**
 * Turns deterministic carrier facts into a plain-English safety plan and the
 * first outreach email. Facts are computed in code; the model only rewrites
 * them into simple English. Every number the model writes is checked against
 * the facts, and any failure falls back to a fixed template.
 */

export const PLAN_MODEL = "anthropic/claude-sonnet-4-6";

export type PlanFix = {
  familyKey: string;
  title: string;
  why: string;
  steps: string[];
  doneWhen: string;
};

export type SafetyPlanContent = {
  headline: string;
  standing: string[];
  fixes: PlanFix[];
  weDo: string[];
  needs: string[];
};

export type OutreachDraft = { subject: string; bodyText: string };

export type PlanBundle = {
  plan: SafetyPlanContent;
  intro: OutreachDraft;
  model: string | null;
  usedFallback: boolean;
};

const SIMPLE_ENGLISH_RULES = [
  "Write for a small trucking company owner whose first language may not be English.",
  "Use short sentences (under 15 words). Use common words. No jargon, no legal words, no violation code numbers, no acronyms except DOT.",
  "Never promise a score change. Never say a violation will be removed.",
  "Do not invent any fact, number, name, date or place. Use only the facts given.",
  "No emojis. No exclamation marks.",
].join("\n");

function pct(value: number) {
  return `${Math.round(value)}%`;
}

export function standingLines(facts: CarrierFacts): string[] {
  if (!facts.hasRecord) {
    return ["We found no roadside inspections or crashes on this DOT number in the last 2 years."];
  }
  const lines: string[] = [];
  lines.push(
    `In the last 2 years, inspectors checked your trucks ${facts.inspectionCount} times and wrote up ${facts.violationCount} problems.`
  );
  const top = facts.families[0];
  if (top && top.share >= 10) {
    lines.push(`${pct(top.share)} of your safety points come from one area: ${top.name.toLowerCase()}.`);
  }
  const { vehicleRate, nationalVehicleRate, driverRate, nationalDriverRate } = facts.oos;
  if (vehicleRate !== null && nationalVehicleRate !== null) {
    const compare = vehicleRate > nationalVehicleRate * 1.1 ? "higher than" : vehicleRate < nationalVehicleRate * 0.9 ? "lower than" : "about the same as";
    lines.push(`${pct(vehicleRate)} of your truck inspections end with the truck put out of service. That is ${compare} the national average of ${pct(nationalVehicleRate)}.`);
  }
  if (driverRate !== null && nationalDriverRate !== null && driverRate > nationalDriverRate * 1.1) {
    lines.push(`${pct(driverRate)} of your driver inspections end with the driver put out of service. The national average is ${pct(nationalDriverRate)}.`);
  }
  if (facts.crashes.length > 0) {
    lines.push(
      facts.crashReviewCandidates > 0
        ? `You have ${facts.crashes.length} crash${facts.crashes.length === 1 ? "" : "es"} on record. We will check if ${facts.crashReviewCandidates === 1 ? "it" : "any"} can be marked "not your fault".`
        : `You have ${facts.crashes.length} crash${facts.crashes.length === 1 ? "" : "es"} on record.`
    );
  }
  return lines;
}

export function weDoLines(facts: CarrierFacts): string[] {
  const lines = [
    "Check your DOT record every day and tell you when something new shows up.",
    "Look at every violation for mistakes we can ask FMCSA to fix.",
  ];
  if (facts.crashReviewCandidates > 0) lines.push("Ask FMCSA to mark crashes that were not your driver's fault as \"not preventable\".");
  lines.push("Send you a short plan every week: what to fix, and which drivers or trucks need attention.");
  return lines;
}

export function needsLines(): string[] {
  return [
    "Your driver list: name and license number for each driver. A phone photo of the license works.",
    "Access to your ELD (electronic log) account: add our assistant as a read-only user.",
    "A signed form that lets us file with FMCSA for you (one click on your plan page).",
  ];
}

function fallbackFix(f: FamilyFact): PlanFix {
  return {
    familyKey: f.key,
    title: f.name,
    why: `This area is ${pct(f.share)} of your safety points (${f.count} write-ups in 2 years).`,
    steps: f.program.slice(0, 3),
    doneWhen: f.workingWhen[0] ?? "No new problems in this area for 90 days.",
  };
}

function fallbackIntro(facts: CarrierFacts, ctx: IntroContext): OutreachDraft {
  const greeting = ctx.contactName ? `Hi ${ctx.contactName.split(" ")[0]},` : "Hello,";
  const intro = ctx.introducedBy
    ? `I am Sunny, the AI assistant at Golden Era Insurance Agency. ${ctx.introducedBy} asked us to help ${facts.company} lower its DOT safety scores.`
    : `I am Sunny, the AI assistant at Golden Era Insurance Agency. We looked at the public DOT safety record for ${facts.company}.`;
  const top = facts.families.slice(0, 3).map((f, i) => `${i + 1}. ${f.name}`).join("\n");
  const body = [
    greeting,
    intro,
    "Here is what we found:",
    standingLines(facts).map((l) => `- ${l}`).join("\n"),
    facts.families.length ? `The 3 things to fix first:\n${top}` : "Your record is clean. We will help you keep it that way.",
    "We made a simple plan for you. It shows what to do this week, step by step. Open it with the button below. No password needed.",
    "To start, the plan page asks for 3 things: your driver list, access to your ELD, and one signature so we can file with FMCSA for you.",
    "Reply to this email with any question.",
  ].join("\n\n");
  return { subject: `${facts.company}: your DOT safety plan`, bodyText: body };
}

export type IntroContext = {
  contactName: string | null;
  introducedBy: string | null;
};

function allowedNumbers(facts: CarrierFacts): Set<string> {
  const values = new Set<string>(["1", "2", "3", "4", "5", "7", "10", "15", "30", "60", "90", "24", "12", "100"]);
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    values.add(String(n));
    values.add(String(Math.round(n)));
  };
  add(facts.inspectionCount);
  add(facts.violationCount);
  add(facts.totalPoints);
  add(facts.oosViolationCount);
  add(facts.crashes.length);
  add(facts.crashReviewCandidates);
  add(facts.powerUnits);
  add(facts.drivers);
  add(facts.oos.vehicleRate);
  add(facts.oos.driverRate);
  add(facts.oos.nationalVehicleRate);
  add(facts.oos.nationalDriverRate);
  for (const f of facts.families) {
    add(f.points); add(f.share); add(f.count); add(f.oosCount); add(f.recentCount);
    for (const line of [...f.program, ...f.workingWhen]) for (const m of line.match(/\d+(?:\.\d+)?/g) ?? []) values.add(m);
  }
  for (const b of facts.perBasic) { add(b.points); add(b.count); }
  for (const m of facts.dotNumber.match(/\d+/g) ?? []) values.add(m);
  for (const m of facts.company.match(/\d+/g) ?? []) values.add(m);
  return values;
}

export function findUnsupportedNumbers(text: string, facts: CarrierFacts): string[] {
  const allowed = allowedNumbers(facts);
  return [...new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n)))];
}

function client(): OpenAI | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://safescore.vercel.app", "X-Title": "Golden Era SafeScore Autopilot" },
  });
}

type ModelOutput = {
  headline: string;
  fixes: Array<{ familyKey: string; title: string; why: string; steps: string[]; doneWhen: string }>;
  email: { subject: string; body: string };
};

function validateModelOutput(output: ModelOutput, facts: CarrierFacts, familyKeys: string[]): string[] {
  const problems: string[] = [];
  if (!output || typeof output.headline !== "string" || !output.headline.trim()) problems.push("headline missing");
  if (!Array.isArray(output?.fixes) || output.fixes.length !== familyKeys.length) problems.push(`need exactly ${familyKeys.length} fixes`);
  else output.fixes.forEach((fix, i) => {
    if (fix.familyKey !== familyKeys[i]) problems.push(`fix ${i + 1} must be ${familyKeys[i]}`);
    if (!fix.title?.trim() || !fix.why?.trim() || !fix.doneWhen?.trim()) problems.push(`fix ${i + 1} incomplete`);
    if (!Array.isArray(fix.steps) || fix.steps.length < 2 || fix.steps.length > 4) problems.push(`fix ${i + 1} needs 2-4 steps`);
  });
  if (!output?.email?.subject?.trim() || !output?.email?.body?.trim()) problems.push("email missing");
  const allText = JSON.stringify(output ?? {});
  if (/\[[^\]]{1,60}\]/.test(output?.email?.body ?? "")) problems.push("placeholder brackets in email");
  const unsupported = findUnsupportedNumbers(allText, facts);
  if (unsupported.length) problems.push(`numbers not in the facts: ${unsupported.slice(0, 6).join(", ")}`);
  if (/!/.test(output?.email?.body ?? "")) problems.push("no exclamation marks");
  return problems;
}

export async function generatePlanBundle(facts: CarrierFacts, ctx: IntroContext): Promise<PlanBundle> {
  // "General safety" is the catch-all for codes with no program; it is never
  // an actionable fix on its own, so it only appears when nothing else does.
  const specific = facts.families.filter((f) => f.points > 0 && f.key !== "general_safety");
  const topFamilies = (specific.length ? specific : facts.families.filter((f) => f.points > 0)).slice(0, 3);
  const standing = standingLines(facts);
  const base: Omit<SafetyPlanContent, "headline" | "fixes"> = { standing, weDo: weDoLines(facts), needs: needsLines() };
  const fallback: PlanBundle = {
    plan: {
      headline: topFamilies.length
        ? `Fix ${topFamilies[0].name.toLowerCase()} first. It is the biggest part of your safety score.`
        : "Your record is clean. Keep it that way.",
      fixes: topFamilies.map(fallbackFix),
      ...base,
    },
    intro: fallbackIntro(facts, ctx),
    model: null,
    usedFallback: true,
  };

  const ai = client();
  if (!ai) return fallback;

  const factSheet = {
    company: facts.company,
    contactFirstName: ctx.contactName?.split(" ")[0] ?? null,
    introducedBy: ctx.introducedBy,
    standing,
    whatGeiaWillDo: base.weDo,
    whatWeNeedFromYou: base.needs,
    topAreas: topFamilies.map((f) => ({
      familyKey: f.key,
      name: f.name,
      shareOfPointsPercent: Math.round(f.share),
      writeUpsIn2Years: f.count,
      writeUpsInLast6Months: f.recentCount,
      mostCommon: f.topDescriptions,
      approvedProgram: f.program,
      workingWhen: f.workingWhen,
    })),
  };

  const system = [
    "You write for Golden Era SafeScore, a DOT safety service run by an insurance agency.",
    SIMPLE_ENGLISH_RULES,
    "Return JSON only, with this shape:",
    '{"headline": string, "fixes": [{"familyKey": string, "title": string, "why": string, "steps": [string], "doneWhen": string}], "email": {"subject": string, "body": string}}',
    `fixes: exactly ${topFamilies.length}, in the same order as topAreas, familyKey copied exactly. Steps: 2 to 4 concrete actions for THIS WEEK, rewritten from approvedProgram in simple English (who does it, when). Do not add programs that are not in approvedProgram.`,
    "headline: one sentence, the single most important thing to fix.",
    "email: from Sunny, the AI assistant at Golden Era Insurance Agency. Say plainly that Sunny is an AI assistant. If introducedBy is set, say that person asked us to help. Include 2-3 of the standing facts as '- ' bullet lines, list the 3 areas to fix first as numbered lines, say the plan link below needs no password, list the 3 things we need, and invite a reply. Under 170 words. Plain text, paragraphs separated by a blank line. Do not include a signature (it is added automatically). Do not include a link (a button is added automatically).",
  ].join("\n\n");

  let correction = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await ai.chat.completions.create({
        model: PLAN_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Facts:\n${JSON.stringify(factSheet, null, 2)}${correction}` },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "";
      const output = JSON.parse(raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()) as ModelOutput;
      const problems = validateModelOutput(output, facts, topFamilies.map((f) => f.key));
      if (problems.length === 0) {
        return {
          plan: {
            headline: output.headline.trim(),
            fixes: output.fixes.map((f) => ({ ...f, steps: f.steps.map((s) => s.trim()) })),
            ...base,
          },
          intro: { subject: output.email.subject.trim(), bodyText: output.email.body.trim() },
          model: PLAN_MODEL,
          usedFallback: false,
        };
      }
      correction = `\n\nYour last answer had these problems. Fix them:\n- ${problems.join("\n- ")}`;
    } catch (error) {
      correction = `\n\nYour last answer failed: ${error instanceof Error ? error.message : String(error)}. Return valid JSON only.`;
    }
  }
  return fallback;
}
