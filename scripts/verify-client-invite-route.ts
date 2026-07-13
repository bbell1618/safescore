import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const clientId = process.argv[2];
const baseUrl = (process.argv[3] ?? "https://safescore.vercel.app").replace(/\/$/, "");

if (!clientId) {
  throw new Error(
    "Usage: npx tsx scripts/verify-client-invite-route.ts <client-id> [base-url]"
  );
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const token = randomUUID();
  const email = `safescore-invite-policy-${Date.now()}@example.com`;
  let inviteId: string | null = null;

  try {
    const { data: invite, error: insertError } = await supabase
      .from("client_invites")
      .insert({ client_id: clientId, email, token })
      .select("id")
      .single();

    if (insertError || !invite) {
      throw insertError ?? new Error("Synthetic invite insert returned no row");
    }
    inviteId = invite.id;

    const response = await fetch(
      `${baseUrl}/api/auth/setup?token=${encodeURIComponent(token)}`,
      { headers: { accept: "application/json" } }
    );
    const body = (await response.json()) as {
      companyName?: string | null;
      email?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(`Deployed invite validation returned ${response.status}: ${body.error}`);
    }
    if (body.email !== email || !body.companyName) {
      throw new Error("Deployed invite validation response did not match the synthetic row");
    }

    console.log(
      JSON.stringify({
        created: 1,
        deployedStatus: response.status,
        matchedEmail: true,
        matchedClient: true,
      })
    );
  } finally {
    if (inviteId) {
      const { error: deleteError } = await supabase
        .from("client_invites")
        .delete()
        .eq("id", inviteId);
      if (deleteError) throw deleteError;

      const { count, error: countError } = await supabase
        .from("client_invites")
        .select("id", { count: "exact", head: true })
        .eq("id", inviteId);
      if (countError) throw countError;
      console.log(JSON.stringify({ cleaned: count === 0 ? 1 : 0, remaining: count }));
    }
  }
}

void main();
