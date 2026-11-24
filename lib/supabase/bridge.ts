// QF-230 (Brandon, 11/24/2026): GoldenDesk runs the GEIA side of SafeScore. GoldenDesk calls this
// app's existing staff API routes server-to-server with the signed-in person's own Supabase session
// (both apps use the same Supabase project and the same staff account). Every route keeps its own
// checks: the token is verified by Supabase and the person must still be GEIA staff here.
export const BRIDGE_HEADER = "x-goldendesk-bridge";

export function bridgeToken(headers: Headers): string | null {
  if (headers.get(BRIDGE_HEADER) !== "1") return null;
  const auth = headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(auth.trim());
  return m ? m[1] : null;
}
