import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCarrier, getOosRates } from "@/lib/fmcsa/client";
import { runClientRefresh } from "@/lib/monitoring/run-client-refresh";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
import { renderAutopilotEmail } from "@/lib/email/client";
import { buildCarrierFacts, type CarrierFacts } from "./facts";
import { findCarrierContact, type CarrierContact } from "./contacts";
import { generatePlanBundle, type PlanBundle } from "./plan";
import { enqueueCard, serviceClient } from "./queue";

export const DAVEN_EMAIL = "davenloomba@goldenerainsurance.com";
export const INFO_EMAIL = "info@goldenerainsurance.com";

export function appUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return value || "https://safescore.vercel.app";
}

export function planUrl(token: string) {
  return `${appUrl()}/plan/${token}`;
}

export function normalizeDot(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 8 ? String(Number(digits)) : null;
}

async function log(service: SupabaseClient, clientId: string, action: string, description: string, metadata: Record<string, unknown> = {}) {
  await service.from("activity_log").insert({
    client_id: clientId,
    action_type: action,
    entity_type: "client",
    entity_id: clientId,
    description,
    metadata,
  });
}

export type IntakeResult = {
  clientId: string;
  company: string;
  existing: boolean;
  contactSource: CarrierContact["source"];
  planVersion: number | null;
  cardId: string | null;
  usedFallback: boolean;
  steps: string[];
};

/** Builds a fresh plan from current data and stores it as the next draft version. */
export async function buildAndStorePlan(
  service: SupabaseClient,
  clientId: string,
  ctx: { contactName: string | null; introducedBy: string | null }
): Promise<{ planId: string; version: number; bundle: PlanBundle; facts: CarrierFacts }> {
  const { data: client } = await service.from("clients").select("dot_number").eq("id", clientId).single();
  const oos = client?.dot_number ? await getOosRates(client.dot_number as string).catch(() => null) : null;
  const facts = await buildCarrierFacts(service, clientId, oos
    ? { vehicleOosRate: oos.vehicleOosRate, driverOosRate: oos.driverOosRate, nationalVehicleOosRate: oos.nationalVehicleOosRate, nationalDriverOosRate: oos.nationalDriverOosRate }
    : null);
  const bundle = await generatePlanBundle(facts, ctx);
  const { data: latest } = await service
    .from("safety_plans")
    .select("version")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((latest?.version as number | undefined) ?? 0) + 1;
  const { data: row, error } = await service
    .from("safety_plans")
    .insert({ client_id: clientId, version, status: "draft", content: bundle.plan, facts, model: bundle.model })
    .select("id")
    .single();
  if (error || !row) throw new Error(`Unable to save safety plan: ${error?.message}`);
  return { planId: row.id as string, version, bundle, facts };
}

/** Queues the first-contact email for approval, or a needs-info card when no email exists. */
export async function queueIntroCard(
  service: SupabaseClient,
  input: { clientId: string; company: string; planToken: string; planId: string; email: string | null; geiaClient: boolean; bundle: PlanBundle; contactName: string | null }
): Promise<string> {
  if (!input.email) {
    return enqueueCard({
      clientId: input.clientId,
      kind: "needs_info",
      template: "needs_contact_email",
      title: `Who should we email at ${input.company}?`,
      why: "The plan is ready, but no email was found in GoldenDesk or the FMCSA census. Add one and the intro email will be drafted for you.",
      payload: { field: "contact_email", planId: input.planId },
      dedupeKey: `intro:${input.clientId}`,
    }, service);
  }
  const cc = input.geiaClient ? `${DAVEN_EMAIL}, ${INFO_EMAIL}` : null;
  const bodyHtml = renderAutopilotEmail({
    bodyText: input.bundle.intro.bodyText,
    cta: { label: "Open your safety plan", href: planUrl(input.planToken) },
  });
  return enqueueCard({
    clientId: input.clientId,
    kind: "email",
    template: "autopilot_intro",
    title: `Send ${input.company} their safety plan`,
    why: input.geiaClient
      ? "First contact. This carrier is a GEIA insured, so Daven and info@ are CC'd to show the request comes from him."
      : "First contact. The plan page is how the carrier signs up, sends what we need, and sees what to fix.",
    toAddress: input.email,
    cc,
    subject: input.bundle.intro.subject,
    bodyText: input.bundle.intro.bodyText,
    bodyHtml,
    editable: true,
    payload: {
      cta: { label: "Open your safety plan", href: planUrl(input.planToken) },
      onApprove: [{ type: "publish_plan", planId: input.planId }],
      planId: input.planId,
      usedFallback: input.bundle.usedFallback,
      contactName: input.contactName,
    },
    dedupeKey: `intro:${input.clientId}`,
  }, service);
}

/**
 * DOT in, everything else automatic: create the carrier, pull FMCSA, compute
 * the record, write the plan, and queue the first email for approval.
 */
export async function runDotIntake(dotInput: unknown, options: { email?: string | null } = {}): Promise<IntakeResult> {
  const dot = normalizeDot(dotInput);
  if (!dot) throw new Error("Enter a valid USDOT number (digits only).");
  const service = serviceClient();
  const steps: string[] = [];

  const { data: existing } = await service
    .from("clients")
    .select("id, name, plan_token, email, geia_client, primary_contact")
    .eq("dot_number", dot)
    .maybeSingle();

  let clientId: string;
  let company: string;
  let planToken: string;
  let contact: CarrierContact;
  let email: string | null;
  let geiaClient: boolean;
  let contactName: string | null;

  if (existing) {
    clientId = existing.id as string;
    company = existing.name as string;
    planToken = existing.plan_token as string;
    contact = await findCarrierContact(dot);
    email = options.email?.trim().toLowerCase() || (existing.email as string | null) || contact.email;
    geiaClient = Boolean(existing.geia_client) || contact.geiaClient;
    contactName = (existing.primary_contact as string | null) ?? contact.contactName;
    steps.push(`Already in SafeScore: ${company}. Rebuilt the plan from today's data.`);
  } else {
    const carrier = await getCarrier(dot).catch(() => null);
    if (!carrier || !carrier.legalName) throw new Error(`FMCSA has no carrier for USDOT ${dot}.`);
    contact = await findCarrierContact(dot);
    email = options.email?.trim().toLowerCase() || contact.email;
    geiaClient = contact.geiaClient;
    contactName = contact.contactName;
    company = carrier.legalName;
    const { data: inserted, error } = await service
      .from("clients")
      .insert({
        name: carrier.legalName,
        dot_number: dot,
        mc_number: carrier.mcNumber,
        address: carrier.phyStreet || null,
        city: carrier.phyCity || null,
        state: carrier.phyState ? carrier.phyState.slice(0, 2) : null,
        zip: carrier.phyZip || null,
        phone: contact.phone,
        email,
        primary_contact: contactName,
        primary_contact_title: contact.contactTitle,
        fleet_size: carrier.totalPowerUnits || null,
        tier: "assessment",
        status: "prospect",
        geia_client: geiaClient,
        intake_source: "dot_intake",
        contact_source: contact.source,
        goldendesk_client_id: contact.goldendeskClientId,
      })
      .select("id, plan_token")
      .single();
    if (error || !inserted) throw new Error(`Unable to create carrier: ${error?.message}`);
    clientId = inserted.id as string;
    planToken = inserted.plan_token as string;
    steps.push(`Created ${company} (USDOT ${dot})${geiaClient ? ", a GEIA insured" : ""}.`);
    steps.push(
      contact.source === "goldendesk"
        ? `Contact from GoldenDesk: ${contactName ?? "no name"}${email ? ` <${email}>` : ", no email"}.`
        : contact.source === "fmcsa_census"
          ? `Contact from the FMCSA census${email ? `: ${email}` : ""}.`
          : "No contact email found yet."
    );
    await log(service, clientId, "autopilot_intake_created", `Created from DOT ${dot} by Autopilot`, { contactSource: contact.source });
  }

  const refresh = await runClientRefresh({ clientId, dotNumber: dot }, service);
  steps.push(`Pulled FMCSA: ${refresh.inspectionsPulled} inspections, ${refresh.violationsProcessed} violations, ${refresh.crashesPulled} crashes.`);
  await captureBurdenSnapshot(clientId, existing ? "rerun" : "intake", service).catch((error) => {
    steps.push(`Snapshot skipped: ${error instanceof Error ? error.message : String(error)}`);
  });

  const { planId, version, bundle, facts } = await buildAndStorePlan(service, clientId, {
    contactName,
    introducedBy: geiaClient ? "Daven Loomba" : null,
  });
  steps.push(`Wrote plan v${version}: ${facts.totalPoints} points; top area ${facts.families[0]?.name ?? "none"}${bundle.usedFallback ? " (template wording)" : ""}.`);

  const cardId = await queueIntroCard(service, { clientId, company, planToken, planId, email, geiaClient, bundle, contactName });
  steps.push(email ? "Intro email is waiting in your Inbox." : "Needs a contact email (card in your Inbox).");
  await log(service, clientId, "autopilot_intake_completed", `Plan v${version} written; intro card queued`, { planId, cardId, usedFallback: bundle.usedFallback });

  return { clientId, company, existing: Boolean(existing), contactSource: contact.source, planVersion: version, cardId, usedFallback: bundle.usedFallback, steps };
}
