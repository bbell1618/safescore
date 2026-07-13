import { createClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";

export async function createDeployedClientSession(baseUrl: string, email: string) {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${baseUrl}/auth/callback?next=/portal` },
  });
  if (linkError || !link.properties?.hashed_token) {
    throw linkError ?? new Error("Could not create client verification session");
  }
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const verified = await authClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error("Client verification did not produce a session");
  }
  const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${stringToBase64URL(JSON.stringify(verified.data.session))}`;
  return {
    cookie: createChunks(storageKey, encoded).map(({ name, value }) => `${name}=${value}`).join("; "),
    revoke: async () => {
      const { error } = await service.auth.admin.signOut(verified.data.session!.access_token, "local");
      if (error) throw error;
    },
  };
}
