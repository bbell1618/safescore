import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Truck, Users2, Info } from "lucide-react";

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
      <span className="text-sm text-gray-500 shrink-0 w-40">{label}</span>
      <span className="text-sm text-[#222222] text-right">{value ?? "—"}</span>
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
          <h2
            className="text-lg font-bold text-[#222222]"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Your account is being set up
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md">
            Your company profile will appear here once your GEIA account manager links your account.
          </p>
        </div>
      </div>
    );
  }

  const clientId = userRecord.client_id;

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();

  if (!client) redirect("/portal");

  const address = [client.address, client.city, client.state, client.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1
          className="text-xl font-bold text-[#222222]"
          style={{ fontFamily: "var(--font-montserrat)" }}
        >
          Company profile
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Your company information on file with GEIA.
        </p>
      </div>

      {/* Company info card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h2
            className="font-semibold text-[#222222] text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Company information
          </h2>
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
          <h2
            className="font-semibold text-[#222222] text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Fleet
          </h2>
        </div>

        <ProfileRow
          label="Power units"
          value={
            client.fleet_size != null ? client.fleet_size.toString() : null
          }
        />
        <ProfileRow
          label="Drivers"
          value={
            client.driver_count != null
              ? client.driver_count.toString()
              : null
          }
        />
      </div>

      {/* Subscription card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users2 className="w-4 h-4 text-gray-400" />
          <h2
            className="font-semibold text-[#222222] text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Service tier
          </h2>
        </div>

        <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5]">
          <span className="text-sm text-gray-500 shrink-0 w-40">Tier</span>
          <span className="text-sm text-[#222222]">
            {client.tier ? (
              <Badge variant={tierVariant(client.tier)}>
                {tierLabel[client.tier]}
              </Badge>
            ) : (
              "—"
            )}
          </span>
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <span className="text-sm text-gray-500 shrink-0 w-40">
            Account status
          </span>
          <span className="text-sm text-[#222222]">
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
