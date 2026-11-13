import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createClient as createServiceClient } from "@/lib/supabase/schema-client";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { sendLoginCodeEmail } from "@/lib/email/client";
import { isClientPostOnboardingLifecycle } from "@/lib/auth/access";

/**
 * QF-199: sign in with a 6-digit code emailed to the person. One code works once, expires in 10 minutes,
 * allows 5 wrong tries, and at most 5 codes can be requested per email per hour. The same reply is given
 * whether or not the email has an account, so the page cannot be used to find out who has one.
 */
export const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const MAX_REQUESTS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function service() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function secret() {
  return (process.env.LOGIN_CODE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}
export function hashCode(email: string, code: string): string {
  return createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");
}
/** ilike treats % and _ as wildcards; an email must match exactly (ignoring case) and nothing else. */
export function exactLike(email: string): string {
  return email.replace(/[\\%_]/g, "\\$&");
}
export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return EMAIL_RE.test(email) ? email : null;
}

export async function requestLoginCode(rawEmail: unknown): Promise<{ ok: boolean; dryRun?: boolean; error?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const db = service();
  const { data: account } = await db.from("users").select("id").ilike("email", exactLike(email)).limit(1).maybeSingle();
  if (!account) return { ok: true }; // same answer as success

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("login_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since);
  if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) return { ok: true };

  await db.from("login_codes").update({ used_at: new Date().toISOString() }).eq("email", email).is("used_at", null);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db.from("login_codes").insert({
    email, code_hash: hashCode(email, code), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  });
  if (error) return { ok: false, error: "We could not start sign-in. Please try again." };
  const sent = await sendLoginCodeEmail({ to: email, code, minutes: CODE_MINUTES });
  if (!sent.success) return { ok: false, error: "We could not send the code. Please try again in a minute." };
  return { ok: true, dryRun: Boolean(sent.dryRun) };
}

export type VerifyResult = { ok: true; nextPath: string } | { ok: false; error: string };

export async function verifyLoginCode(rawEmail: unknown, rawCode: unknown): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
  const generic = { ok: false as const, error: "That code did not work. Check it and try again, or ask for a new one." };
  if (!email || code.length !== 6) return generic;
  const db = service();
  const { data: row } = await db.from("login_codes").select("*").eq("email", email).is("used_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_TRIES) return generic;

  // Count the try before checking, so parallel guesses cannot beat the limit.
  const { data: counted } = await db.from("login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id).eq("attempts", row.attempts).select("id").maybeSingle();
  if (!counted) return generic;
  const a = Buffer.from(hashCode(email, code), "hex");
  const b = Buffer.from(row.code_hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return generic;
  const { data: used } = await db.from("login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id").maybeSingle();
  if (!used) return generic;

  const { data: account } = await db.from("users").select("id, email, role, client_id").ilike("email", exactLike(email)).limit(1).maybeSingle();
  if (!account) return generic;
  const link = await db.auth.admin.generateLink({ type: "magiclink", email: account.email as string });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return { ok: false, error: "We could not sign you in. Please try again." };
  const session = await createSessionClient();
  const { error: verifyError } = await session.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verifyError) return { ok: false, error: "We could not sign you in. Please try again." };

  if (account.role !== "client_user") return { ok: true, nextPath: "/console" };
  const { data: client } = await db.from("clients").select("status").eq("id", account.client_id).maybeSingle();
  return { ok: true, nextPath: client && isClientPostOnboardingLifecycle(client) ? "/portal" : "/onboarding" };
}
