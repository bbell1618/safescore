import "server-only";
import { fmcsaDot, PRACTICE_DOT_PREFIX } from "@/lib/fmcsa/practice";
import { runDotIntake } from "./intake";
import { serviceClient } from "./queue";

/**
 * Finishes work GoldenDesk asks for (QF-212, QF-215):
 *  - a carrier added there arrives as a placeholder row named "DOT 123 (looking up)";
 *  - a re-run is asked for by setting intake_requested_at (new contact email, insured switch changed).
 * Each run looks the carrier up, pulls FMCSA, fills the file, builds the plan and queues the invite card.
 *
 * A row is claimed first so two runs never work the same carrier; a stuck claim is retried after 10 minutes.
 * After two failed tries the row is parked as 'goldendesk_failed' with the reason on the carrier, so a bad
 * DOT cannot loop every minute. GoldenDesk shows the reason and a "Try again" button.
 */

type StubRow = { id: string; dot_number: string | null; geia_client: boolean | null; intake_source: string | null; updated_at: string; is_practice: boolean | null; name: string | null };

const COLUMNS = "id, dot_number, geia_client, intake_source, updated_at, is_practice, name";

export async function processGoldenDeskStubs(limit = 2) {
  const service = serviceClient();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const claimable = `intake_source.eq.goldendesk,and(intake_source.eq.goldendesk_processing,updated_at.lt.${staleBefore})`;
  const [placeholders, requested] = await Promise.all([
    service.from("clients").select(COLUMNS).like("name", "%(looking up)").or(claimable).order("created_at", { ascending: true }).limit(limit),
    service.from("clients").select(COLUMNS).not("intake_requested_at", "is", null).or(claimable).order("intake_requested_at", { ascending: true }).limit(limit),
  ]);
  const findError = placeholders.error ?? requested.error;
  if (findError) throw new Error(`Could not look for new carriers: ${findError.message}`);
  const seen = new Set<string>();
  const rows = [...((placeholders.data ?? []) as StubRow[]), ...((requested.data ?? []) as StubRow[])]
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .slice(0, limit);
  if (rows.length) console.log(`[intake-stubs] ${rows.length} carrier(s) waiting`);

  const results: { dot: string; ok: boolean; note: string }[] = [];
  for (const row of rows) {
    const { data: claimed } = await service
      .from("clients")
      .update({ intake_source: "goldendesk_processing" })
      .eq("id", row.id)
      .eq("intake_source", row.intake_source as string)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    const startedAt = new Date().toISOString();
    const stored = String(row.dot_number ?? "");
    const practice = Boolean(row.is_practice) || stored.startsWith(PRACTICE_DOT_PREFIX);
    const dot = fmcsaDot(stored);
    try {
      const r = await runDotIntake(dot, { geiaInsured: Boolean(row.geia_client), insuredDecided: true, practice, skipIntroIfDecided: true });
      await service.from("clients").update({ intake_source: "goldendesk" }).eq("id", row.id);
      // A request made while this run was working stays, so the next run picks it up.
      await service.from("clients").update({ intake_requested_at: null }).eq("id", row.id).lte("intake_requested_at", startedAt);
      results.push({ dot, ok: true, note: r.steps.join(" ") });
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { count: earlier } = await service.from("activity_log").select("id", { count: "exact", head: true })
        .eq("client_id", row.id).eq("action_type", "goldendesk_lookup_failed").gte("created_at", since);
      const giveUp = (earlier ?? 0) >= 1 || /has no carrier/i.test(note);
      await service.from("clients")
        .update(giveUp ? { intake_source: "goldendesk_failed", intake_requested_at: null } : { intake_source: "goldendesk" })
        .eq("id", row.id);
      await service.from("activity_log").insert({
        client_id: row.id, action_type: "goldendesk_lookup_failed", entity_type: "client", entity_id: row.id,
        description: `Setup for DOT ${dot} failed: ${note}`.slice(0, 500),
        metadata: { gaveUp: giveUp },
      });
      console.error(`[intake-stubs] DOT ${dot} failed${giveUp ? " (parked)" : ""}: ${note}`);
      results.push({ dot, ok: false, note });
    }
  }
  return results;
}
