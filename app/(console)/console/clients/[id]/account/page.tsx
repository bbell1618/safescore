import { ClientActivationControl } from "@/components/console/client-activation-control";
import { isStaffManualActivationCandidate } from "@/lib/activation/staff-manual-activation";
import { MonitoringWatchCard } from "@/components/console/monitoring-watch-card";
import { Suspense } from "react";
import ReportsSection from "@/components/console/sections/reports-section";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  AuthorityInsuranceSection,
  type CarrierProfileEnrichmentRow,
} from "@/components/console/authority-insurance-section";
import { PortalAccessCard } from "@/components/console/portal-access-card";
import { FmcsaPinRequestControl } from "@/components/console/fmcsa-pin-request-control";
import { createClient } from "@/lib/supabase/server";
import { tierDisplayLabel } from "@/lib/tiers";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type AccountClient = Record<string, unknown> & {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
  primary_contact: string | null;
  email: string | null;
  phone: string | null;
  tier: string | null;
  status: string | null;
};

type SubscriptionRow = {
  id: string;
  tier: string;
  status: string;
  mrr: number | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  created_at: string;
};

type CredentialRow = {
  id: string;
  fmcsa_dot_number: string | null;
  last_used_at: string | null;
  updated_at: string;
};

function boolLabel(value: unknown) {
  return value === true ? "Yes" : "No";
}

function boolVariant(value: unknown): "success" | "outline" {
  return value === true ? "success" : "outline";
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return "Not recorded";
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: client, error: clientError },
    { data: subscriptions, error: subscriptionsError },
    { data: credentials, error: credentialsError },
    { count: credentialPinCount, error: credentialPinError },
    { data: openPinRequest, error: openPinRequestError },
    { data: enrichmentRows, error: enrichmentError },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("subscriptions")
      .select(
        "id, tier, status, mrr, billing_cycle, current_period_end, trial_end, created_at"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("client_credentials")
      .select("id, fmcsa_dot_number, last_used_at, updated_at")
      .eq("client_id", id)
      .limit(1),
    supabase
      .from("client_credentials")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .not("fmcsa_pin_encrypted", "is", null),
    supabase
      .from("client_requests")
      .select("id")
      .eq("client_id", id)
      .eq("category", "fmcsa_portal_pin")
      .eq("status", "open")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("carrier_profile_enrichments")
      .select(
        "id, client_id, source, source_url, source_as_of, fetched_at, currentness, data, parser_version, created_at, updated_at"
      )
      .eq("client_id", id)
      .order("source", { ascending: true }),
  ]);

  for (const error of [clientError, subscriptionsError, credentialsError]) if (error && error.code !== "PGRST116") throw new Error(`Unable to load account: ${error.message}`);
  if (!client) notFound();
  if (enrichmentError) {
    throw new Error(
      `Unable to load authority and insurance data: ${enrichmentError.message}`
    );
  }
  if (credentialPinError) {
    throw new Error(
      `Unable to verify FMCSA Portal PIN status: ${credentialPinError.message}`
    );
  }
  if (openPinRequestError) {
    throw new Error(
      `Unable to load FMCSA Portal PIN request status: ${openPinRequestError.message}`
    );
  }

  const account = client as AccountClient;
  const subscription = ((subscriptions ?? []) as SubscriptionRow[])[0] ?? null;
  const credential = ((credentials ?? []) as CredentialRow[])[0] ?? null;
  const hasFmcsaPortalPin = (credentialPinCount ?? 0) > 0;
  const authorityInsuranceRows =
    (enrichmentRows ?? []) as unknown as CarrierProfileEnrichmentRow[];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6"><header className="portal-navy-texture rounded-2xl p-6 text-warm-white"><p className="font-mono text-xs uppercase tracking-widest text-gold-light">Service administration</p><h1 className="mt-2 font-heading text-4xl">Account</h1><p className="mt-3 text-sm text-warm-white/75">{account.name} · USDOT {account.dot_number}</p></header>
      <div>


        <section className="bg-warm-white rounded-xl border border-sand p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-2xl text-navy">Service</h2><Badge variant="gold">{tierDisplayLabel(account.tier)}</Badge></div>
          {isStaffManualActivationCandidate({ tier: client.tier, status: client.status, serviceAgreementAccepted: client.service_agreement_accepted === true }) && <div className="mt-4"><ClientActivationControl clientId={id} status={client.status} tier={client.tier} serviceAgreementAccepted={client.service_agreement_accepted === true} /></div>}
          {subscription ? (
            <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <Field label="Tier" value={tierDisplayLabel(subscription.tier)} />
              <div><p className="text-xs text-warm-gray">Stripe subscription status on record</p><Badge variant={subscription.status === "active" ? "success" : "warning"}>{subscription.status}</Badge></div>
              <Field label="MRR" value={subscription.mrr == null ? "Not recorded" : `$${subscription.mrr}`} />
              <Field label="Billing cycle" value={subscription.billing_cycle ?? "Not recorded"} />
              <Field label="Current period end" value={formatDate(subscription.current_period_end)} />
              <Field label="Trial end" value={formatDate(subscription.trial_end)} />
            </div>
          ) : (
            <p className="text-sm text-gray-500 mt-4">No subscription row on file.</p>
          )}
        </section>
      </div>

      <PortalAccessCard clientId={id} defaultEmail={account.email} />
        <section className="bg-warm-white rounded-xl border border-sand p-5 shadow-sm">
          <h2 className="font-heading text-2xl text-navy">Contacts and company</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <Field label="Carrier" value={account.name} />
            <Field label="Status" value={textValue(account.status)} />
            <Field label="USDOT" value={account.dot_number} />
            <Field label="MC" value={account.mc_number ?? "Not recorded"} />
            <Field label="Primary contact" value={account.primary_contact ?? "Not recorded"} />
            <Field label="Email" value={account.email ?? "Not recorded"} />
            <Field label="Phone" value={account.phone ?? "Not recorded"} />
            <Field label="Plan" value={tierDisplayLabel(account.tier)} />
          </div>
        </section>
      <Suspense fallback={<p role="status">Loading monitoring settings…</p>}><MonitoringWatchCard clientId={id} /></Suspense>

      <AuthorityInsuranceSection
        clientId={id}
        billingDriverCount={
          typeof account.driver_count === "number"
            ? account.driver_count
            : null
        }
        rows={authorityInsuranceRows}
      />

      <section className="bg-warm-white rounded-xl border border-sand p-5 shadow-sm">
        <h2 className="font-heading text-xl text-navy">Authorizations</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="border border-[#F0E8DA] bg-white/60 rounded-lg p-4">
            <p className="text-xs text-gray-500">Service agreement</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={boolVariant(account.service_agreement_accepted)}>{boolLabel(account.service_agreement_accepted)}</Badge>
              <span className="text-xs text-gray-500">{formatDate(account.service_agreement_date as string | null)}</span>
            </div>
          </div>
          <div className="border border-[#F0E8DA] bg-white/60 rounded-lg p-4">
            <p className="text-xs text-gray-500">Filing authorization</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={boolVariant(account.filing_authorized)}>{boolLabel(account.filing_authorized)}</Badge>
              <span className="text-xs text-gray-500">{textValue(account.filing_authorized_by)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">{textValue(account.filing_authorization_scope)}</p>
          </div>
          <div className="border border-[#F0E8DA] bg-white/60 rounded-lg p-4">
            <p className="text-xs text-gray-500">FMCSA data access</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={boolVariant(account.fmcsa_authorized)}>{boolLabel(account.fmcsa_authorized)}</Badge>
              <span className="text-xs text-gray-500">{formatDate(account.fmcsa_auth_date as string | null)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#D9C395] bg-[#FBF7F0] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#8B8178]">
              Secure carrier access
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[#1E1C1A]">
              FMCSA Portal PIN
            </h2>
          </div>
          <Badge variant={boolVariant(hasFmcsaPortalPin)}>
            {boolLabel(hasFmcsaPortalPin)}
          </Badge>
        </div>
        {credential ? (
          <div className="mt-5 grid gap-4 md:grid-cols-3 text-sm">
            <Field label="Credential row" value={credential.id.slice(0, 8)} />
            <Field label="DOT on credential" value={credential.fmcsa_dot_number ?? "Not recorded"} />
            <Field label="Last used" value={formatDate(credential.last_used_at)} />
            <Field label="Updated" value={formatDate(credential.updated_at)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            No FMCSA Portal PIN is on file.
          </p>
        )}
        {!hasFmcsaPortalPin ? (
          <>
            <p className="mt-4 rounded-lg border border-[#1B2D4F]/10 bg-[#E8ECF2] px-4 py-3 text-sm text-[#2A4270]">
              <strong>Where the client can find it:</strong> Log in to the{" "}
              <span className="font-mono text-xs">ai.fmcsa.dot.gov</span>{" "}
              portal and look under profile settings.
            </p>
            <FmcsaPinRequestControl
              clientId={id}
              requestAlreadyOpen={Boolean(openPinRequest)}
            />
          </>
        ) : null}
        <p className="mt-4 text-xs text-gray-400">
          Secret PIN values are intentionally never displayed in the console.
        </p>
      </section>
      <section id="reports" className="scroll-mt-6"><Suspense fallback={<p role="status">Loading reports…</p>}><ReportsSection params={params} /></Suspense></section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-[#1E1C1A] mt-1 break-words">{value}</p>
    </div>
  );
}
