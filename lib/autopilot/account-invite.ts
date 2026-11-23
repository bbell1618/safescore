import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * QF-221: the carrier's first click makes an account. Every carrier email links here:
 *  - no account yet  -> /setup?token=... (create a password, then the sign-up steps)
 *  - account exists  -> /login (they land on sign-up or the portal by themselves)
 * One live invite per carrier and email; older unused ones are closed so a stale link cannot be used.
 */

const INVITE_DAYS = 45;

export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app").replace(/\/+$/, "");
}

export async function carrierHasAccount(service: SupabaseClient, clientId: string): Promise<boolean> {
  const { count } = await service.from("users").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("role", "client_user");
  return Boolean(count);
}

/** The link to put in a carrier email. Creates the invite when needed. */
export async function accountLink(service: SupabaseClient, clientId: string, email: string | null): Promise<{ href: string; label: string; hasAccount: boolean }> {
  if (await carrierHasAccount(service, clientId)) {
    return { href: `${appBase()}/login`, label: "Sign in to your account", hasAccount: true };
  }
  const address = (email ?? "").trim().toLowerCase();
  if (!address) return { href: `${appBase()}/login`, label: "Sign in to your account", hasAccount: false };
  const now = new Date();
  const { data: live } = await service
    .from("client_invites")
    .select("id, token, email, expires_at")
    .eq("client_id", clientId)
    .is("used_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false });
  const match = (live ?? []).find((row) => String(row.email).toLowerCase() === address);
  const stale = (live ?? []).filter((row) => row.id !== match?.id).map((row) => row.id as string);
  if (stale.length) await service.from("client_invites").update({ expires_at: now.toISOString() }).in("id", stale);
  const expires = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  if (match) {
    await service.from("client_invites").update({ expires_at: expires }).eq("id", match.id);
    return { href: `${appBase()}/setup?token=${match.token}`, label: "Set up your account", hasAccount: false };
  }
  const { data: created, error } = await service
    .from("client_invites")
    .insert({ client_id: clientId, email: address, expires_at: expires })
    .select("token")
    .single();
  if (error || !created) throw new Error(`Unable to create the account invite: ${error?.message ?? "no invite returned"}`);
  return { href: `${appBase()}/setup?token=${created.token}`, label: "Set up your account", hasAccount: false };
}
