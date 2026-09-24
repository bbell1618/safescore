import "server-only";
import { createClient } from "@supabase/supabase-js";

export type OutboxMessage = {
  to: string; template: string; subject: string; htmlBody: string; clientId?: string | null;
};
export type OutboxActionLink = { label: string; href: string };

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
export function outboxText(html: string) {
  return decode(html.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
export function outboxActionLinks(html: string): OutboxActionLink[] {
  const links: OutboxActionLink[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(match[2]);
    try {
      const url = new URL(href);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      if (!links.some(link => link.href === href)) links.push({ href, label: outboxText(match[3]) || "Open link" });
    } catch { /* A malformed URL is not an actionable link. The original email is retained. */ }
  }
  return links;
}

/** No logging: rendered messages can contain bearer links. Failure never falls through to SMTP. */
export async function writeDryRunOutbox(message: OutboxMessage) {
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let clientId = message.clientId ?? null;
  if (message.clientId === undefined) {
    const match = await service.from("clients").select("id").eq("email", message.to.trim().toLowerCase()).limit(2);
    if (match.error) throw new Error(`Unable to associate dry-run email: ${match.error.message}`);
    if (match.data?.length === 1) clientId = match.data[0].id;
  }
  const { data, error } = await service.from("email_dry_run_outbox").insert({
    to_address: message.to, template: message.template, subject: message.subject,
    body_html: message.htmlBody, body_text: outboxText(message.htmlBody),
    action_links: outboxActionLinks(message.htmlBody), client_id: clientId,
  }).select("id").single();
  if (error || !data) throw new Error(`Unable to save dry-run email: ${error?.message ?? "no outbox row returned"}`);
  return data.id as string;
}
