import "server-only";
import { runDotIntake } from "./intake";
import { serviceClient } from "./queue";

/**
 * Carriers added from GoldenDesk arrive as a placeholder row named "DOT 123 (looking up)".
 * This finishes them: look the carrier up, pull FMCSA, build the plan, queue the approval card.
 * Each row is claimed first so two runs never work the same carrier; a stuck claim is retried after 10 minutes.
 */
export async function processGoldenDeskStubs(limit = 2) {
  const service = serviceClient();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: rows, error: findError } = await service
    .from("clients")
    .select("id, dot_number, geia_client, intake_source, updated_at")
    .like("name", "%(looking up)")
    .or(`intake_source.eq.goldendesk,and(intake_source.eq.goldendesk_processing,updated_at.lt.${staleBefore})`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (findError) throw new Error(`Could not look for new carriers: ${findError.message}`);
  console.log(`[intake-stubs] ${rows?.length ?? 0} carrier(s) waiting`);
  const results: { dot: string; ok: boolean; note: string }[] = [];
  for (const row of rows ?? []) {
    const { data: claimed } = await service
      .from("clients")
      .update({ intake_source: "goldendesk_processing" })
      .eq("id", row.id)
      .eq("intake_source", row.intake_source as string)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      console.log(`[intake-stubs] could not claim ${row.id}`);
      continue;
    }
    const dot = String(row.dot_number);
    try {
      const r = await runDotIntake(dot, { geiaInsured: Boolean(row.geia_client) });
      await service.from("clients").update({ intake_source: "goldendesk" }).eq("id", row.id);
      results.push({ dot, ok: true, note: r.steps.join(" ") });
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      // Back to waiting so the next run retries; the reason is recorded on the carrier.
      await service.from("clients").update({ intake_source: "goldendesk" }).eq("id", row.id);
      await service.from("activity_log").insert({ client_id: row.id, action_type: "goldendesk_lookup_failed", description: `Lookup for DOT ${dot} failed: ${note}`.slice(0, 500) });
      results.push({ dot, ok: false, note });
    }
  }
  return results;
}
