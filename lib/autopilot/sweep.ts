import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { narrativeBlockReason } from "@/lib/analysis/narrative-sentinels";
import { appUrl } from "./intake";
import { enqueueCard, serviceClient } from "./queue";

/**
 * Daily sweep: turns finished internal work into approval cards so nothing
 * waits on Brandon noticing it in a tab.
 *  - coaching playbooks written but not published
 *  - DataQs / crash-review cases whose packet is complete (ready to file)
 *  - reports written but not sent
 */

async function alreadyDecided(service: SupabaseClient, dedupeKey: string) {
  const { count } = await service
    .from("outbound_queue")
    .select("id", { count: "exact", head: true })
    .eq("dedupe_key", dedupeKey)
    .in("status", ["approved", "sent", "rejected"]);
  return (count ?? 0) > 0;
}

function clientName(value: unknown): string {
  const row = (Array.isArray(value) ? value[0] : value) as { name?: string } | null;
  return row?.name ?? "Carrier";
}

async function sweepPlaybooks(service: SupabaseClient) {
  const { data, error } = await service
    .from("client_playbooks")
    .select("id, client_id, version, family_programs, generated_at, clients(name)")
    .in("review_status", ["draft", "reviewed"])
    .order("generated_at", { ascending: false });
  if (error) throw new Error(`playbooks: ${error.message}`);
  let queued = 0;
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.client_id as string)) continue; // newest draft per carrier only
    seen.add(row.client_id as string);
    const key = `playbook:${row.id}`;
    if (await alreadyDecided(service, key)) continue;
    const programs = (Array.isArray(row.family_programs) ? row.family_programs : []) as Array<Record<string, unknown>>;
    const summary = programs
      .slice(0, 8)
      .map((p, i) => `${i + 1}. ${String(p.name ?? p.familyName ?? p.key ?? "Program")}`)
      .join("\n");
    const name = clientName(row.clients);
    await enqueueCard({
      clientId: row.client_id as string,
      kind: "playbook_publish",
      template: "autopilot_playbook",
      title: `Publish ${name}'s coaching playbook (v${row.version})`,
      why: "The coaching playbook is written from their violation history. Approving makes it visible to the carrier on their portal.",
      bodyText: `Programs in this version:\n${summary || "(none listed)"}\n\nFull playbook: ${appUrl()}/console/clients/${row.client_id}/remediation/playbook`,
      payload: { playbookId: row.id, onApprove: [{ type: "playbook_publish", playbookId: row.id }] },
      dedupeKey: key,
    }, service);
    queued += 1;
  }
  return queued;
}

function filingSteps(kind: "DataQ" | "CPDP") {
  return kind === "CPDP"
    ? [
        "Sign in to DataQs (dataqs.fmcsa.dot.gov) with the carrier-authorized account.",
        "Choose Add Request > Crash > Crash Preventability Determination.",
        "Find the crash using the FMCSA report number below.",
        "Pick the crash type, paste the explanation below, and attach the police report.",
        "Read the federal attestation, submit, and copy the new request number.",
        "Paste that request number into this card.",
      ]
    : [
        "Sign in to DataQs (dataqs.fmcsa.dot.gov) with the carrier-authorized account.",
        "Choose Add Request > Inspection > the matching request type.",
        "Find the inspection using the report number below.",
        "Paste the explanation below and attach the evidence files.",
        "Submit and copy the new request number.",
        "Paste that request number into this card.",
      ];
}

async function sweepFilings(service: SupabaseClient) {
  let queued = 0;
  const { data: cpdp, error: cpdpError } = await service
    .from("cpdp_cases")
    .select("id, client_id, final_narrative, ai_narrative, par_assessment_status, crashes(report_number, crash_date, state, par_document_id), clients(name, dot_number, filing_authorized)")
    .eq("status", "draft");
  if (cpdpError) throw new Error(`cpdp: ${cpdpError.message}`);
  for (const row of cpdp ?? []) {
    const crash = (Array.isArray(row.crashes) ? row.crashes[0] : row.crashes) as { report_number: string | null; crash_date: string | null; state: string | null; par_document_id: string | null } | null;
    const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as { name: string; dot_number: string; filing_authorized: boolean | null } | null;
    const narrative = (row.final_narrative ?? row.ai_narrative) as string | null;
    if (!client?.filing_authorized || !crash?.par_document_id || row.par_assessment_status !== "approved" || !narrative || narrativeBlockReason(narrative)) continue;
    const key = `filing:cpdp:${row.id}`;
    if (await alreadyDecided(service, key)) continue;
    await enqueueCard({
      clientId: row.client_id as string,
      kind: "filing_packet",
      template: "autopilot_filing",
      title: `File crash review for ${client.name} (${crash.crash_date ?? "crash"}, ${crash.state?.trim() ?? ""})`,
      why: "The police report is in and checked, the explanation is written, and the carrier signed the filing authorization. Filing in DataQs needs a person signed in, so this is the one step you do by hand.",
      bodyText: [
        `Carrier: ${client.name} (DOT ${client.dot_number})`,
        `FMCSA crash report number: ${crash.report_number ?? "see case"}`,
        "",
        "Steps:",
        ...filingSteps("CPDP").map((s, i) => `${i + 1}. ${s}`),
        "",
        "Explanation to paste:",
        narrative,
        "",
        `Case in SafeScore: ${appUrl()}/console/clients/${row.client_id}/cpdp/${row.id}`,
      ].join("\n"),
      payload: { field: "fmcsa_case_number", caseKind: "CPDP", caseId: row.id },
      dedupeKey: key,
    }, service);
    queued += 1;
  }

  const { data: dataq, error: dataqError } = await service
    .from("dataq_cases")
    .select("id, client_id, final_narrative, ai_narrative, filed_without_evidence, inspections(report_number, inspection_date, state), clients(name, dot_number, filing_authorized)")
    .eq("status", "draft");
  if (dataqError) throw new Error(`dataq: ${dataqError.message}`);
  for (const row of dataq ?? []) {
    const inspection = (Array.isArray(row.inspections) ? row.inspections[0] : row.inspections) as { report_number: string | null; inspection_date: string | null; state: string | null } | null;
    const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as { name: string; dot_number: string; filing_authorized: boolean | null } | null;
    const narrative = (row.final_narrative ?? row.ai_narrative) as string | null;
    if (!client?.filing_authorized || !narrative || narrativeBlockReason(narrative)) continue;
    const [{ count: total }, { count: received }] = await Promise.all([
      service.from("dataq_evidence").select("id", { count: "exact", head: true }).eq("case_id", row.id),
      service.from("dataq_evidence").select("id", { count: "exact", head: true }).eq("case_id", row.id).eq("required", true).eq("status", "received"),
    ]);
    if ((total ?? 0) > 0 && (received ?? 0) === 0 && row.filed_without_evidence !== true) continue;
    const key = `filing:dataq:${row.id}`;
    if (await alreadyDecided(service, key)) continue;
    await enqueueCard({
      clientId: row.client_id as string,
      kind: "filing_packet",
      template: "autopilot_filing",
      title: `File DataQs challenge for ${client.name} (inspection ${inspection?.inspection_date ?? ""})`,
      why: "The evidence is in, the explanation is written, and the carrier signed the filing authorization. Filing in DataQs needs a person signed in, so this is the one step you do by hand.",
      bodyText: [
        `Carrier: ${client.name} (DOT ${client.dot_number})`,
        `Inspection report number: ${inspection?.report_number ?? "see case"} (${inspection?.state?.trim() ?? ""} ${inspection?.inspection_date ?? ""})`,
        "",
        "Steps:",
        ...filingSteps("DataQ").map((s, i) => `${i + 1}. ${s}`),
        "",
        "Explanation to paste:",
        narrative,
        "",
        `Case in SafeScore: ${appUrl()}/console/clients/${row.client_id}/dataq`,
      ].join("\n"),
      payload: { field: "fmcsa_case_number", caseKind: "DataQ", caseId: row.id },
      dedupeKey: key,
    }, service);
    queued += 1;
  }
  return queued;
}

export type SweepResult = { playbooks: number; filings: number; errors: string[] };

export async function runDailySweep(): Promise<SweepResult> {
  const service = serviceClient();
  const result: SweepResult = { playbooks: 0, filings: 0, errors: [] };
  try { result.playbooks = await sweepPlaybooks(service); } catch (e) { result.errors.push(e instanceof Error ? e.message : String(e)); }
  try { result.filings = await sweepFilings(service); } catch (e) { result.errors.push(e instanceof Error ? e.message : String(e)); }
  return result;
}
