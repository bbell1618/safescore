import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";

loadEnvConfig(process.cwd());
const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const email = "safescore-phase11-acme@example.com";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function session() {
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error("Synthetic client auth user missing; run Phase 5 gate first");
  const link = await service.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${baseUrl}/auth/callback?next=/portal` } });
  if (link.error || !link.data.properties?.hashed_token) throw link.error ?? new Error("Login link failed");
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await anon.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("Client session failed");
  const key = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  return { cookie: createChunks(key, `base64-${stringToBase64URL(JSON.stringify(verified.data.session))}`).map(({ name, value }) => `${name}=${value}`).join("; "), accessToken: verified.data.session.access_token };
}

async function main() {
  await service.from("clients").update({ fmcsa_authorized: false, fmcsa_auth_date: null }).eq("id", clientId);
  const auth = await session();
  const before = await fetch(`${baseUrl}/portal`, { headers: { cookie: auth.cookie } });
  const beforeHtml = await before.text();
  if (before.status !== 200 || !beforeHtml.includes("FMCSA access is incomplete")) throw new Error("Persistent incomplete-access banner missing");

  const profile = await fetch(`${baseUrl}/api/portal/onboarding-profile`, { method: "POST", headers: { cookie: auth.cookie, "content-type": "application/json" }, body: JSON.stringify({ contactName: "Phase 11 Test Client", contactTitle: "Safety Director", contactPhone: "555-0100", contactEmail: email, vehicleTypes: ["Dry van"], operatingStates: ["CA", "NV"], operatingRadius: "regional", driverCount: 17, eldProvider: "SyntheticELD", safetyContactName: "Phase 11 Safety Contact", safetyContactEmail: email, serviceAgreementAccepted: true, filingAuthorized: true, filingAuthorizedBy: "Phase 11 Test Client, Safety Director", standingAuthorization: true }) });
  if (!profile.ok) throw new Error(`Profile route failed: ${profile.status} ${await profile.text()}`);
  const credentials = await fetch(`${baseUrl}/api/portal/fmcsa-credentials`, { method: "POST", headers: { cookie: auth.cookie, "content-type": "application/json" }, body: JSON.stringify({ pin: "TEST-PIN-PHASE7", authorized: true }) });
  if (!credentials.ok) throw new Error(`Credentials route failed: ${credentials.status} ${await credentials.text()}`);

  const after = await fetch(`${baseUrl}/portal`, { headers: { cookie: auth.cookie } });
  const afterHtml = await after.text();
  if (after.status !== 200 || afterHtml.includes("FMCSA access is incomplete")) throw new Error("FMCSA banner did not clear");
  const [{ data: client }, { data: credential }] = await Promise.all([
    service.from("clients").select("id,driver_count,eld_provider,safety_contact_name,safety_contact_email,standing_authorization,standing_authorized_at,fmcsa_authorized,fmcsa_auth_date,filing_authorized,filing_authorized_at,filing_authorization_scope").eq("id", clientId).single(),
    service.from("client_credentials").select("id,client_id,fmcsa_dot_number,fmcsa_pin_encrypted,updated_at").eq("client_id", clientId).single(),
  ]);
  if (!client?.fmcsa_authorized || !client.standing_authorization || client.driver_count !== 17 || !credential?.fmcsa_pin_encrypted) throw new Error("Persisted onboarding fields incomplete");

  const clientScoped = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${auth.accessToken}` } }, auth: { persistSession: false } });
  const rls = await clientScoped.from("client_credentials").select("id").eq("client_id", clientId);
  if (!rls.error && (rls.data?.length ?? 0) > 0) throw new Error("Client session could read client_credentials");
  const { fmcsa_pin_encrypted: _secret, ...credentialProof } = credential;
  console.log(JSON.stringify({ clientId, beforeBanner: true, afterBanner: false, profileStatus: profile.status, credentialStatus: credentials.status, client, credential: { ...credentialProof, secretStored: true }, clientCredentialRead: { rows: rls.data?.length ?? 0, blocked: !!rls.error || (rls.data?.length ?? 0) === 0 }, billingRule: { clientStated: 17, fmcsaReferenceOnly: true } }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
