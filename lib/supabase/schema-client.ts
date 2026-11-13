// QF-199: every Supabase client in the app is created through here so the whole app can be pointed at the
// `safescore` schema of the shared database by setting NEXT_PUBLIC_SUPABASE_DB_SCHEMA. Unset means `public`
// (the original database), so nothing changes until the switch-over.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient as baseClient } from "@supabase/supabase-js";
import { createBrowserClient as baseBrowser, createServerClient as baseServer } from "@supabase/ssr";

export const DB_SCHEMA = (process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ?? "").trim() || "public";

/** On the shared database carriers must carry the restricted role so their login cannot reach GoldenDesk tables. */
export function authRole(): string | undefined {
  return DB_SCHEMA === "public" ? undefined : "safescore_authenticated";
}

function withSchema<T extends { db?: Record<string, unknown> } | undefined>(options: T): any {
  if (DB_SCHEMA === "public") return options;
  return { ...(options ?? {}), db: { ...((options as any)?.db ?? {}), schema: DB_SCHEMA } };
}

export function createClient(url: string, key: string, options?: Parameters<typeof baseClient>[2]) {
  return baseClient(url, key, withSchema(options as any));
}
export function createServerClient(url: string, key: string, options: Parameters<typeof baseServer>[2]) {
  return baseServer(url, key, withSchema(options as any));
}
export function createBrowserClient(url: string, key: string, options?: Parameters<typeof baseBrowser>[2]) {
  return baseBrowser(url, key, withSchema(options as any));
}

export type { SupabaseClient } from "@supabase/supabase-js";
