import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Finds who to talk to at a carrier, from the best source available:
 * 1. GoldenDesk (GEIA's CRM) when the carrier is already a GEIA client.
 * 2. The FMCSA company census (the email and phone the carrier filed).
 * Returns null fields rather than guessing.
 */

export type CarrierContact = {
  source: "goldendesk" | "fmcsa_census" | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  goldendeskClientId: string | null;
  geiaClient: boolean;
  goldendeskAccountNumber: string | null;
  otherContacts: Array<{ name: string; email: string | null; phone: string | null; role: string | null }>;
};

const EMPTY: CarrierContact = {
  source: null, contactName: null, contactTitle: null, email: null, phone: null,
  goldendeskClientId: null, geiaClient: false, goldendeskAccountNumber: null, otherContacts: [],
};

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The agency CRM's address is not a secret; only the key is. */
const GOLDENDESK_DEFAULT_URL = "https://pkrzpyqdrtcvfnuvzriv.supabase.co";

function goldenDeskUrl() {
  return process.env.GOLDENDESK_SUPABASE_URL?.trim() || GOLDENDESK_DEFAULT_URL;
}

export function goldenDeskConfigured() {
  return Boolean(process.env.GOLDENDESK_SERVICE_ROLE_KEY?.trim());
}

async function fromGoldenDesk(dot: string): Promise<CarrierContact | null> {
  if (!goldenDeskConfigured()) return null;
  const gd = createClient(goldenDeskUrl(), process.env.GOLDENDESK_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rows, error } = await gd
    .from("clients")
    .select("id, account_name, account_number, email, phone, primary_phone, primary_contact, primary_contact_role, lifecycle")
    .or(`dot_number.eq.${dot},dot.eq.${dot}`)
    .limit(2);
  if (error) throw new Error(`GoldenDesk lookup failed: ${error.message}`);
  const client = rows?.[0];
  if (!client) return null;

  const { data: edges } = await gd
    .from("entity_links")
    .select("source_id, metadata")
    .eq("source_type", "contact")
    .eq("target_type", "client")
    .eq("target_id", client.id)
    .is("deleted_at", null);
  const ids = (edges ?? []).map((e) => e.source_id as string);
  const { data: contacts } = ids.length
    ? await gd.from("contacts").select("id, name, email, phone, title").in("id", ids).is("deleted_at", null)
    : { data: [] as Array<{ id: string; name: string; email: string | null; phone: string | null; title: string | null }> };
  const roleOf = new Map((edges ?? []).map((e) => [e.source_id as string, ((e.metadata ?? {}) as { role?: string }).role ?? null]));
  const others = (contacts ?? []).map((c) => ({
    name: c.name as string,
    email: cleanEmail(c.email),
    phone: cleanText(c.phone),
    role: roleOf.get(c.id as string) ?? cleanText(c.title),
  }));

  const primaryName = cleanText(client.primary_contact);
  const primary = others.find((o) => primaryName && o.name.toLowerCase() === primaryName.toLowerCase());
  return {
    source: "goldendesk",
    contactName: primaryName ?? others.find((o) => o.email)?.name ?? null,
    contactTitle: cleanText(client.primary_contact_role) ?? primary?.role ?? null,
    email: cleanEmail(client.email) ?? primary?.email ?? others.find((o) => o.email)?.email ?? null,
    phone: cleanText(client.primary_phone) ?? cleanText(client.phone) ?? primary?.phone ?? null,
    goldendeskClientId: client.id as string,
    geiaClient: client.lifecycle === "client",
    goldendeskAccountNumber: cleanText(client.account_number),
    otherContacts: others,
  };
}

async function fromCensus(dot: string): Promise<CarrierContact | null> {
  const headers: Record<string, string> = {};
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  const response = await fetch(`https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=${encodeURIComponent(dot)}`, {
    headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  const row = rows?.[0];
  if (!row) return null;
  const pick = (pattern: RegExp) => {
    for (const [key, value] of Object.entries(row)) if (pattern.test(key) && cleanText(value)) return cleanText(value);
    return null;
  };
  const email = cleanEmail(pick(/email/i));
  const phone = pick(/^(telephone|phone|phy_phone|cell_phone)/i);
  const officer = pick(/officer_?1|company_officer/i);
  if (!email && !phone) return null;
  return { ...EMPTY, source: "fmcsa_census", contactName: officer, email, phone };
}

export async function findCarrierContact(dot: string): Promise<CarrierContact> {
  try {
    const gd = await fromGoldenDesk(dot);
    if (gd && gd.email) return gd;
    const census = await fromCensus(dot).catch(() => null);
    if (gd) return { ...gd, email: gd.email ?? census?.email ?? null, phone: gd.phone ?? census?.phone ?? null };
    return census ?? EMPTY;
  } catch (error) {
    console.error("[autopilot] contact lookup failed:", error instanceof Error ? error.message : error);
    const census = await fromCensus(dot).catch(() => null);
    return census ?? EMPTY;
  }
}
