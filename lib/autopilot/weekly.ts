import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { renderAutopilotEmail } from "@/lib/email/client";
import { buildCarrierFacts, type CarrierFacts } from "./facts";
import { DAVEN_EMAIL, INFO_EMAIL, planUrl } from "./intake";
import { findUnsupportedNumbers, PLAN_MODEL, type SafetyPlanContent } from "./plan";
import { enqueueCard, serviceClient } from "./queue";

/**
 * The weekly Autopilot pass. For every carrier it decides what (if anything)
 * should go out this week and queues it as ONE card, so a carrier gets one
 * useful email a week instead of a stream of alerts. It also writes the
 * weekly summary for Daven.
 */

const DAY = 86_400_000;

export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

type WeeklyClient = {
  id: string;
  name: string;
  dot_number: string;
  status: string;
  tier: string | null;
  email: string | null;
  primary_contact: string | null;
  geia_client: boolean | null;
  plan_token: string;
  plan_first_viewed_at: string | null;
  plan_last_viewed_at: string | null;
  service_agreement_accepted: boolean | null;
  filing_authorized: boolean | null;
  eld_provider: string | null;
};

type CarrierWeek = {
  client: WeeklyClient;
  facts: CarrierFacts;
  plan: SafetyPlanContent | null;
  newInspections: Array<{ date: string; state: string | null; violations: number; oos: number }>;
  burdenNow: number | null;
  burdenWeekAgo: number | null;
  burdenBaseline: number | null;
  baselineDate: string | null;
  openAsks: string[];
  driverCount: number;
  cases: Array<{ kind: string; status: string; number: string | null; outcome: string | null }>;
  nudgesSent: number;
  engaged: boolean;
};

async function loadCarrierWeek(service: SupabaseClient, client: WeeklyClient): Promise<CarrierWeek> {
  const now = Date.now();
  const since = new Date(now - 7 * DAY).toISOString();
  const [facts, planRow, inspections, snapshots, requests, drivers, dataq, cpdp, nudges] = await Promise.all([
    buildCarrierFacts(service, client.id),
    service.from("safety_plans").select("content").eq("client_id", client.id).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle(),
    service.from("inspections").select("inspection_date, state, total_violations, oos_violations, created_at").eq("client_id", client.id).gte("created_at", since).order("inspection_date", { ascending: false }),
    service.from("burden_snapshots").select("total_points, captured_at").eq("client_id", client.id).order("captured_at", { ascending: true }),
    service.from("client_requests").select("title, request_type").eq("client_id", client.id).eq("status", "open").eq("responsibility", "client"),
    service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", client.id),
    service.from("dataq_cases").select("status, case_number, outcome, determination_outcome").eq("client_id", client.id),
    service.from("cpdp_cases").select("status, case_number, outcome, determination_outcome").eq("client_id", client.id),
    service.from("outbound_queue").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("template", "autopilot_weekly").eq("status", "sent"),
  ]);
  const snaps = (snapshots.data ?? []) as Array<{ total_points: number; captured_at: string }>;
  const latest = snaps.at(-1) ?? null;
  const weekAgo = [...snaps].reverse().find((s) => new Date(s.captured_at).getTime() <= now - 6 * DAY) ?? null;
  const openAsks: string[] = [];
  if (!client.service_agreement_accepted || !client.filing_authorized) openAsks.push("Sign the one-page authorization on your plan page");
  if ((drivers.count ?? 0) === 0) openAsks.push("Add your driver list on your plan page");
  if (!client.eld_provider) openAsks.push("Give us read-only access to your ELD (steps are on your plan page)");
  for (const r of requests.data ?? []) if (r.request_type !== "roster_collection") openAsks.push(r.title as string);
  return {
    client,
    facts,
    plan: (planRow.data?.content as SafetyPlanContent | undefined) ?? null,
    newInspections: (inspections.data ?? []).map((i) => ({
      date: i.inspection_date as string,
      state: (i.state as string | null)?.trim() ?? null,
      violations: Number(i.total_violations ?? 0),
      oos: Number(i.oos_violations ?? 0),
    })),
    burdenNow: latest?.total_points ?? null,
    burdenWeekAgo: weekAgo?.total_points ?? null,
    burdenBaseline: snaps[0]?.total_points ?? null,
    baselineDate: snaps[0]?.captured_at ?? null,
    openAsks,
    driverCount: drivers.count ?? 0,
    cases: [
      ...((dataq.data ?? []).map((c) => ({ kind: "DataQs", status: String(c.status), number: (c.case_number as string | null) ?? null, outcome: ((c.determination_outcome ?? c.outcome) as string | null) ?? null }))),
      ...((cpdp.data ?? []).map((c) => ({ kind: "Crash review", status: String(c.status), number: (c.case_number as string | null) ?? null, outcome: ((c.determination_outcome ?? c.outcome) as string | null) ?? null }))),
    ],
    nudgesSent: nudges.count ?? 0,
    engaged: Boolean(client.plan_first_viewed_at) || client.status === "active" || Boolean(client.service_agreement_accepted),
  };
}

/** Which of the plan's fixes to focus on this week: most recent write-ups first. */
function focusFix(week: CarrierWeek) {
  const fixes = week.plan?.fixes ?? [];
  if (!fixes.length) return null;
  const recentByFamily = new Map(week.facts.families.map((f) => [f.key, f.recentCount]));
  return [...fixes].sort((a, b) => (recentByFamily.get(b.familyKey as never) ?? 0) - (recentByFamily.get(a.familyKey as never) ?? 0))[0];
}

function deterministicWeeklyEmail(week: CarrierWeek): { subject: string; body: string } {
  const name = week.client.primary_contact?.split(" ")[0];
  const lines: string[] = [name ? `Hi ${name},` : "Hello,", `Here is your weekly safety update for ${week.client.name}.`];
  if (week.newInspections.length) {
    const withProblems = week.newInspections.filter((i) => i.violations > 0).length;
    lines.push(
      `New this week: ${week.newInspections.length} inspection${week.newInspections.length === 1 ? "" : "s"} showed up on your record` +
        (withProblems ? `, and ${withProblems} had problems written up.` : ". None had problems. Good work.")
    );
  } else {
    lines.push("No new inspections showed up on your record this week.");
  }
  const fix = focusFix(week);
  if (fix) lines.push(`This week, focus on ${fix.title.toLowerCase()}:\n${fix.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (week.openAsks.length) lines.push(`We still need from you:\n${week.openAsks.slice(0, 4).map((a) => `- ${a}`).join("\n")}`);
  lines.push("Everything is on your plan page. Reply to this email with any question.");
  return { subject: `${week.client.name}: your safety update this week`, body: lines.join("\n\n") };
}

async function aiWeeklyEmail(week: CarrierWeek, fallback: { subject: string; body: string }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback;
  const ai = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  const fix = focusFix(week);
  const factSheet = {
    company: week.client.name,
    contactFirstName: week.client.primary_contact?.split(" ")[0] ?? null,
    newInspectionsThisWeek: week.newInspections,
    focusThisWeek: fix ? { title: fix.title, steps: fix.steps, workingWhen: fix.doneWhen } : null,
    stillNeededFromCarrier: week.openAsks.slice(0, 4),
    carrierHasOpenedPlan: week.engaged,
  };
  try {
    const response = await ai.chat.completions.create({
      model: PLAN_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Write a weekly safety update email from Sunny, the AI assistant at Golden Era Insurance Agency, to a small trucking company owner whose first language may not be English.",
            "Short sentences under 15 words. Common words. No jargon, no violation codes, no emojis, no exclamation marks. Never promise a score change.",
            "Use only the facts given. Do not invent numbers, names, dates or places.",
            "Structure: greeting; what is new this week (one or two lines); 'This week, focus on' with the steps as numbered lines; if anything is still needed, list it as '- ' lines; close by inviting a reply. If the carrier has not opened the plan yet, gently ask them to open it.",
            "Under 150 words. Plain text, blank line between paragraphs. No signature and no link (both are added automatically).",
            'Return JSON: {"subject": string, "body": string}',
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify(factSheet, null, 2) },
      ],
    });
    const parsed = JSON.parse((response.choices[0]?.message?.content ?? "").replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "")) as { subject?: string; body?: string };
    const text = `${parsed.subject ?? ""}\n${parsed.body ?? ""}`;
    if (!parsed.subject?.trim() || !parsed.body?.trim() || /!/.test(parsed.body)) return fallback;
    const allowed = new Set(JSON.stringify(factSheet).match(/\d+/g) ?? []);
    for (const n of ["1", "2", "3", "4", "7"]) allowed.add(n);
    const unsupported = [...findUnsupportedNumbers(text, week.facts)].filter((n) => !allowed.has(n));
    if (unsupported.length) return fallback;
    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch {
    return fallback;
  }
}

function shouldEmailCarrier(week: CarrierWeek): { send: boolean; reason: string } {
  if (!week.client.email) return { send: false, reason: "no email on file" };
  if (!week.engaged) {
    // Not opened the plan yet: follow up at most 3 times, then stop.
    if (week.nudgesSent >= 3) return { send: false, reason: "3 follow-ups sent without a reply; stopped" };
    return { send: true, reason: "The carrier has not opened the plan yet. This is a gentle follow-up." };
  }
  return { send: true, reason: "Weekly check-in: what changed, what to focus on, and what we still need." };
}

function signed(value: number | null) {
  if (value === null) return "n/a";
  return value > 0 ? `+${value}` : String(value);
}

function davenSummary(weeks: CarrierWeek[], weekKey: string): string {
  const wins: string[] = [];
  const lines: string[] = [];
  for (const w of weeks) {
    const delta = w.burdenNow !== null && w.burdenWeekAgo !== null ? w.burdenNow - w.burdenWeekAgo : null;
    const sinceStart = w.burdenNow !== null && w.burdenBaseline !== null ? w.burdenNow - w.burdenBaseline : null;
    const decided = w.cases.filter((c) => c.outcome && /not_preventable|approved|granted/i.test(c.outcome));
    for (const c of decided) wins.push(`${w.client.name}: FMCSA ${c.kind} decided in our favor${c.number ? ` (${c.number})` : ""}`);
    const top = w.facts.families[0];
    const progress = [
      w.client.service_agreement_accepted && w.client.filing_authorized ? "signed" : "not signed yet",
      w.driverCount ? `${w.driverCount} drivers on file` : "no driver list yet",
      w.client.eld_provider ? `ELD: ${w.client.eld_provider}` : "no ELD access yet",
    ].join(", ");
    lines.push(
      [
        `${w.client.name} (DOT ${w.client.dot_number})`,
        `- Violation points: ${w.burdenNow ?? "n/a"} (this week ${signed(delta)}, since we started ${signed(sinceStart)})`,
        `- New inspections this week: ${w.newInspections.length}${w.newInspections.length ? ` (${w.newInspections.reduce((a, i) => a + i.violations, 0)} write-ups)` : ""}`,
        top ? `- Biggest area: ${top.name} (${Math.round(top.share)}% of points)` : "- Clean record",
        `- Carrier progress: ${progress}`,
        w.cases.length ? `- Challenges: ${w.cases.map((c) => `${c.kind} ${c.status.replace(/_/g, " ")}`).join("; ")}` : "- Challenges: none open",
      ].join("\n")
    );
  }
  return [
    "Hi Daven,",
    `Here is this week's SafeScore update (${weekKey}).`,
    wins.length ? `Wins this week:\n${wins.map((w) => `- ${w}`).join("\n")}` : "No FMCSA decisions came back this week.",
    ...lines,
    "Violation points are the time-weighted points from each carrier's roadside violations. They drive the BASIC scores. They drop when new clean inspections come in and old violations age out.",
    "Reply to this email with any question.",
  ].join("\n\n");
}

export type WeeklyRunResult = {
  week: string;
  carriers: number;
  cardsQueued: number;
  skipped: Array<{ client: string; reason: string }>;
  errors: Array<{ client: string; error: string }>;
  davenCardId: string | null;
};

export async function runWeeklyAutopilot(options: { onlyClientId?: string; now?: Date } = {}): Promise<WeeklyRunResult> {
  const service = serviceClient();
  const weekKey = isoWeek(options.now);
  let query = service
    .from("clients")
    .select("id, name, dot_number, status, tier, email, primary_contact, geia_client, plan_token, plan_first_viewed_at, plan_last_viewed_at, service_agreement_accepted, filing_authorized, eld_provider")
    .in("status", ["prospect", "onboarding", "awaiting_activation", "active"])
    .not("name", "ilike", "ZZ %");
  if (options.onlyClientId) query = query.eq("id", options.onlyClientId);
  const { data: clients, error } = await query;
  if (error) throw new Error(error.message);

  const result: WeeklyRunResult = { week: weekKey, carriers: 0, cardsQueued: 0, skipped: [], errors: [], davenCardId: null };
  const weeks: CarrierWeek[] = [];
  for (const client of (clients ?? []) as WeeklyClient[]) {
    try {
      // Only carriers that already received their plan get weekly email.
      const { count: published } = await service.from("safety_plans").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "published");
      if (!published) {
        result.skipped.push({ client: client.name, reason: "plan not sent yet" });
        continue;
      }
      const week = await loadCarrierWeek(service, client);
      weeks.push(week);
      result.carriers += 1;
      const decision = shouldEmailCarrier(week);
      if (!decision.send) {
        result.skipped.push({ client: client.name, reason: decision.reason });
        continue;
      }
      const fallback = deterministicWeeklyEmail(week);
      const email = await aiWeeklyEmail(week, fallback);
      const cta = { label: "Open your safety plan", href: planUrl(client.plan_token) };
      // Last week's unapproved check-in is stale once this one exists.
      await service
        .from("outbound_queue")
        .update({ status: "superseded", decided_at: new Date().toISOString(), decision_note: "Replaced by a newer weekly check-in" })
        .like("dedupe_key", `weekly:${client.id}:%`)
        .neq("dedupe_key", `weekly:${client.id}:${weekKey}`)
        .eq("status", "pending");
      await enqueueCard({
        clientId: client.id,
        kind: "email",
        template: "autopilot_weekly",
        title: week.engaged ? `Weekly check-in for ${client.name}` : `Follow up with ${client.name} (plan not opened yet)`,
        why: decision.reason,
        toAddress: client.email,
        subject: email.subject,
        bodyText: email.body,
        bodyHtml: renderAutopilotEmail({ bodyText: email.body, cta }),
        editable: true,
        payload: { cta, week: weekKey },
        dedupeKey: `weekly:${client.id}:${weekKey}`,
      }, service);
      result.cardsQueued += 1;
    } catch (e) {
      result.errors.push({ client: client.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!options.onlyClientId && weeks.length) {
    const body = davenSummary(weeks, weekKey);
    result.davenCardId = await enqueueCard({
      clientId: null,
      kind: "email",
      template: "autopilot_daven_weekly",
      title: `Weekly SafeScore update to Daven (${weeks.length} carrier${weeks.length === 1 ? "" : "s"})`,
      why: "Daven asked for a weekly update: what was done, how scores moved, and why.",
      toAddress: DAVEN_EMAIL,
      cc: INFO_EMAIL,
      subject: `SafeScore weekly update: ${weeks.map((w) => w.client.name).join(", ")}`.slice(0, 180),
      bodyText: body,
      bodyHtml: renderAutopilotEmail({ bodyText: body }),
      editable: true,
      payload: { week: weekKey },
      dedupeKey: `davenweekly:${weekKey}`,
    }, service);
    result.cardsQueued += 1;
  }
  return result;
}

/** Turns finished-but-unsent reports into approval cards. */
export async function queueReportCards(): Promise<number> {
  const service = serviceClient();
  const { data: reports, error } = await service
    .from("reports")
    .select("id, client_id, title, type, status, final_content, ai_content, created_at, clients(name, email, plan_token)")
    .in("status", ["reviewed"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  let queued = 0;
  for (const report of reports ?? []) {
    const client = (Array.isArray(report.clients) ? report.clients[0] : report.clients) as { name: string; email: string | null; plan_token: string } | null;
    if (!client?.email) continue;
    const body = `Hello,\n\nYour ${String(report.type)} safety report for ${client.name} is ready. Open your plan page to read it.\n\nReply to this email with any question.`;
    const cta = { label: "Open your safety plan", href: planUrl(client.plan_token) };
    await enqueueCard({
      clientId: report.client_id as string,
      kind: "report_send",
      template: "autopilot_report",
      title: `Send ${String(report.type)} report to ${client.name}`,
      why: "The report is written and reviewed. Approving marks it sent, makes it visible to the carrier, and emails them.",
      toAddress: client.email,
      subject: `${client.name}: your safety report is ready`,
      bodyText: body,
      bodyHtml: renderAutopilotEmail({ bodyText: body, cta }),
      editable: true,
      payload: { cta, reportId: report.id, reportPreview: String(report.final_content ?? report.ai_content ?? "").slice(0, 6000), onApprove: [{ type: "report_sent", reportId: report.id }] },
      dedupeKey: `report:${report.id}`,
    }, service);
    queued += 1;
  }
  return queued;
}
