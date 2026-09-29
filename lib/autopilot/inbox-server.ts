import "server-only";
import { serviceClient, type OutboundRow } from "./queue";

export type InboxCard = OutboundRow & { client_name: string | null; client_dot: string | null };

export type InboxPayload = {
  pending: InboxCard[];
  recent: InboxCard[];
  liveEmail: boolean;
  goldenDeskConnected: boolean;
  counts: { carriers: number; plansPublished: number; plansViewed: number };
};

export async function loadInbox(): Promise<InboxPayload> {
  const service = serviceClient();
  const columns = "*, clients(name, dot_number)";
  const [pending, recent, carriers, published, viewed] = await Promise.all([
    service.from("outbound_queue").select(columns).eq("status", "pending").order("created_at", { ascending: true }).limit(200),
    service.from("outbound_queue").select(columns).neq("status", "pending").order("decided_at", { ascending: false, nullsFirst: false }).limit(25),
    service.from("clients").select("id", { count: "exact", head: true }).not("name", "ilike", "ZZ %"),
    service.from("safety_plans").select("id", { count: "exact", head: true }).eq("status", "published"),
    service.from("clients").select("id", { count: "exact", head: true }).not("plan_first_viewed_at", "is", null),
  ]);
  if (pending.error) throw new Error(pending.error.message);
  if (recent.error) throw new Error(recent.error.message);
  const shape = (rows: unknown[] | null): InboxCard[] =>
    (rows ?? []).map((row) => {
      const r = row as OutboundRow & { clients: { name: string; dot_number: string } | null };
      const { clients, ...rest } = r;
      return { ...rest, client_name: clients?.name ?? null, client_dot: clients?.dot_number ?? null };
    });
  return {
    pending: shape(pending.data),
    recent: shape(recent.data),
    liveEmail: process.env.EMAIL_DRY_RUN?.trim().toLowerCase() === "false",
    goldenDeskConnected: Boolean(process.env.GOLDENDESK_SUPABASE_URL?.trim() && process.env.GOLDENDESK_SERVICE_ROLE_KEY?.trim()),
    counts: { carriers: carriers.count ?? 0, plansPublished: published.count ?? 0, plansViewed: viewed.count ?? 0 },
  };
}
