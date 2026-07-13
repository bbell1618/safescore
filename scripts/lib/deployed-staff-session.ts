import { createClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";

const staffEmail = "brandonbell@goldenerainsurance.com";

export async function createDeployedStaffSession(baseUrl: string) {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: staffEmail,
    options: { redirectTo: `${baseUrl}/auth/callback?next=/console` },
  });
  if (error || !data.properties?.hashed_token) {
    throw error ?? new Error("Could not create the short-lived deployed-route verification token");
  }

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const { data: verification, error: verificationError } = await authClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verificationError || !verification.session) {
    throw verificationError ?? new Error("Verification token did not produce a session");
  }

  const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${stringToBase64URL(JSON.stringify(verification.session))}`;
  const cookie = createChunks(storageKey, encoded)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  return {
    cookie,
    revoke: async () => {
      const { error: signOutError } = await service.auth.admin.signOut(
        verification.session!.access_token,
        "local"
      );
      if (signOutError) throw signOutError;
    },
  };
}
