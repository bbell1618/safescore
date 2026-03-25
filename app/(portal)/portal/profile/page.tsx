import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { NotificationPrefsForm } from "./notification-prefs-form";
import { Building2, Truck, Info, CreditCard, Bell, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

const tierLabel: Record<string, string> = {
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

const tierVariant = (tier: string | null): "default" | "info" | "gold" => {
  if (tier === "total_safety") return "gold";
  if (tier === "remediate") return "info";
  return "default";
};

function ProfileRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5] last:border-0">
      <span className="text-sm text-gray-500 shrink-0 w-44">{label}</span>
      <span className="text-sm text-[#1A1A1A] text-right">{value ?? "—"}</span>
    </div>
  );
}

export default async function PortalProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id, full_name")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#F4F4F4] flex items-center justify-center">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Your account is being set up</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md">
            Your company profile will appear here once your GEIA account manager links your account.
          </p>
        </div>
      </div>
    );
  }

  const clientId = userRecord.client_id;

  const [{ data: client }, { data: subscription }, { data: serviceAgreement }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).single(),
      supabase
        .from("subscriptions" as any)
        .select("stripe_customer_id, status, current_period_end, plan_name")
        .eq("client_id", clientId)
        .single(),
      supabase
        .from("documents")
        .select("id, filename, created_at, storage_path")
        .eq("client_id", clientId)
        .eq("category", "auth_agreement")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!client) redirect("/portal");

  const address = [client.address, client.city, client.state, client.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-[#1A1A1A]">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Your company profile, subscription details, and notification preferences.
        </p>
      </div>

      {/* Company info card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Company information</h2>
        </div>

        <ProfileRow label="Company name" value={client.name} />
        <ProfileRow label="DOT number" value={`DOT ${client.dot_number}`} />
        <ProfileRow
          label="MC number"
          value={client.mc_number ? `MC ${client.mc_number}` : null}
        />
        <ProfileRow label="Address" value={address || null} />
        <ProfileRow label="Phone" value={client.phone} />
        <ProfileRow label="Email" value={client.email} />
        <ProfileRow label="Primary contact" value={client.primary_contact} />
      </div>

      {/* Fleet info card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Truck className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Fleet</h2>
        </div>

        <ProfileRow
          label="Power units"
          value={client.fleet_size != null ? client.fleet_size.toString() : null}
        />
        <ProfileRow
          label="Drivers"
          value={client.driver_count != null ? client.driver_count.toString() : null}
        />
      </div>

      {/* Subscription card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Subscription</h2>
        </div>

        <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5]">
          <span className="text-sm text-gray-500 shrink-0 w-44">Service tier</span>
          <span className="text-sm text-[#1A1A1A]">
            {client.tier ? (
              <Badge variant={tierVariant(client.tier)}>
                {tierLabel[client.tier]}
              </Badge>
            ) : (
              "—"
            )}
          </span>
        </div>

        <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5]">
          <span className="text-sm text-gray-500 shrink-0 w-44">Account status</span>
          <span className="text-sm text-[#1A1A1A]">
            <Badge
              variant={
                client.status === "active"
                  ? "success"
                  : client.status === "paused"
                  ? "warning"
                  : client.status === "churned"
                  ? "danger"
                  : "default"
              }
            >
              {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
            </Badge>
          </span>
        </div>

        {(subscription as any)?.status && (
          <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5]">
            <span className="text-sm text-gray-500 shrink-0 w-44">Billing status</span>
            <span className="text-sm text-[#1A1A1A] capitalize">
              {(subscription as any).status?.replace(/_/g, " ")}
            </span>
          </div>
        )}

        {(subscription as any)?.current_period_end && (
          <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5]">
            <span className="text-sm text-gray-500 shrink-0 w-44">Next payment</span>
            <span className="text-sm text-[#1A1A1A]">
              {new Date((subscription as any).current_period_end * 1000).toLocaleDateString(
                "en-US",
                { month: "long", day: "numeric", year: "numeric" }
              )}
            </span>
          </div>
        )}

        {(subscription as any)?.stripe_customer_id && (
          <div className="pt-4">
            <ManageBillingButton />
          </div>
        )}
      </div>

      {/* Notification preferences */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Notification preferences</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Choose which email alerts you want to receive. Delivered to {user.email}.
        </p>
        <NotificationPrefsForm />
      </div>

      {/* Service agreement */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Service agreement</h2>
        </div>

        {serviceAgreement ? (
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-sm font-medium text-[#1A1A1A]">{serviceAgreement.filename}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Signed{" "}
                {new Date(serviceAgreement.created_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
              On file
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No service agreement on file. Contact your GEIA account manager.
          </p>
        )}
      </div>

      {/* Info notice */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-[#DC362E]/10 flex items-center justify-center shrink-0">
          <Info className="w-3.5 h-3.5 text-[#DC362E]" />
        </div>
        <p className="text-sm text-gray-500">
          To update your company information, contact your GEIA account manager.
        </p>
      </div>
    </div>
  );
}

// Client component for the billing portal button
function ManageBillingButton() {
  return (
    <form action="/api/billing/portal" method="POST">
      <button
        type="submit"
        className="px-4 py-2 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-[#2a2a2a] transition-colors"
      >
        Manage billing
      </button>
    </form>
  );
}
