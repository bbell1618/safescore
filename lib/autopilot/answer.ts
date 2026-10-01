import "server-only";
import { DecisionError } from "./decide";
import { queueIntroCard } from "./intake";
import { serviceClient, type OutboundRow } from "./queue";
import type { PlanBundle } from "./plan";

/** Resolves a needs-info card (e.g. a missing contact email) and continues the flow. */
export async function answerCard(id: string, userId: string | null, value: string) {
  const service = serviceClient();
  const { data, error } = await service.from("outbound_queue").select("*").eq("id", id).maybeSingle();
  if (error) throw new DecisionError(error.message, 500);
  const row = data as OutboundRow | null;
  if (!row) throw new DecisionError("Card not found.", 404);
  if (row.status !== "pending" || (row.kind !== "needs_info" && row.kind !== "filing_packet")) throw new DecisionError("This card does not take an answer.", 400);

  const field = row.payload?.field;
  if (field === "fmcsa_case_number") return recordFiling(row, userId, value);
  if (field !== "contact_email") throw new DecisionError("Unknown question on this card.", 400);
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DecisionError("Enter a valid email address.");
  if (!row.client_id) throw new DecisionError("Card is not linked to a carrier.", 400);

  const { data: client, error: clientError } = await service
    .from("clients")
    .update({ email, contact_source: "operator" })
    .eq("id", row.client_id)
    .select("id, name, plan_token, geia_client, primary_contact, is_practice")
    .single();
  if (clientError || !client) throw new DecisionError(clientError?.message ?? "Carrier not found", 500);

  const planId = String(row.payload?.planId ?? "");
  const { data: plan } = await service.from("safety_plans").select("id, content, model").eq("id", planId).maybeSingle();
  if (!plan) throw new DecisionError("The plan for this card is missing. Re-run the DOT.", 409);

  await service
    .from("outbound_queue")
    .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: userId, decision_note: `Contact email set to ${email}` })
    .eq("id", id)
    .eq("status", "pending");

  // Keep the plan that was already written; only the intro email is redrafted
  // so it can greet the contact.
  const { data: facts } = await service.from("safety_plans").select("facts").eq("id", planId).single();
  const { generatePlanBundle } = await import("./plan");
  const bundle: PlanBundle = await generatePlanBundle(facts?.facts as never, {
    contactName: (client.primary_contact as string | null) ?? null,
    introducedBy: client.geia_client ? "Daven Loomba" : null,
  });
  bundle.plan = plan.content as PlanBundle["plan"];
  const cardId = await queueIntroCard(service, {
    clientId: client.id as string,
    company: client.name as string,
    planToken: client.plan_token as string,
    planId,
    email,
    geiaClient: Boolean(client.geia_client),
    bundle,
    contactName: (client.primary_contact as string | null) ?? null,
    practice: Boolean(client.is_practice),
  });
  return { status: "answered", cardId };
}

/** The one manual step: Brandon filed in DataQs and pastes the request number. */
async function recordFiling(row: OutboundRow, userId: string | null, value: string) {
  const service = serviceClient();
  const caseNumber = value.trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(caseNumber)) throw new DecisionError("Paste the DataQs request number (letters, numbers and dashes only).");
  const table = row.payload?.caseKind === "CPDP" ? "cpdp_cases" : "dataq_cases";
  const caseId = String(row.payload?.caseId ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await service
    .from(table)
    .update({ status: "filed", case_number: caseNumber, filed_date: today, updated_at: new Date().toISOString() })
    .eq("id", caseId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) throw new DecisionError(error.message, 500);
  if (!data) throw new DecisionError("That case is no longer a draft. Reload the Inbox.", 409);
  await service
    .from("outbound_queue")
    .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: userId, decision_note: `Filed in DataQs as ${caseNumber}` })
    .eq("id", row.id)
    .eq("status", "pending");
  await service.from("activity_log").insert({
    client_id: row.client_id,
    user_id: userId,
    action_type: "case_filed",
    entity_type: table,
    entity_id: caseId,
    description: `Filed with FMCSA DataQs as ${caseNumber}`,
    metadata: { via: "autopilot_inbox", caseNumber },
  });
  return { status: "filed", caseNumber };
}
