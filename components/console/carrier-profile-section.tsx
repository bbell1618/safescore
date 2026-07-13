"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Building2, Truck, Users2, Phone, MapPin, Calendar, ShieldCheck, Loader2 } from "lucide-react";

interface CarrierProfile {
  id: string;
  legal_name: string | null;
  dba_name: string | null;
  address: string | null;
  phone: string | null;
  power_units: number | null;
  drivers: number | null;
  mcs150_date: string | null;
  mcs150_mileage: number | null;
  safety_rating: string | null;
  authority_status: string | null;
  raw_api_response: Record<string, unknown> | null;
  fetched_at: string;
}

interface Props {
  clientId: string;
  profile: CarrierProfile | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function rawField(raw: Record<string, unknown> | null, key: string): string {
  if (!raw) return "—";
  const val = raw[key];
  return val != null && val !== "" ? String(val) : "—";
}

function operatingStatus(raw: Record<string, unknown> | null): string {
  const status = rawField(raw, "usdotStatus") || rawField(raw, "statusCode");
  if (status === "—") return "—";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function carrierOps(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const ops: string[] = [];
  const op = raw["carrierOperation"];
  if (op) ops.push(String(op));
  if (raw["mxInterstateFlag"] === "Y") ops.push("Mexico cross-border");
  return ops;
}

export function CarrierProfileSection({ clientId, profile: initialProfile }: Props) {
  const [profile, setProfile] = useState<CarrierProfile | null>(initialProfile);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/carrier-profile`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setRefreshError(data.error ?? "Failed to refresh carrier data");
      } else {
        setProfile(data.profile);
        router.refresh();
      }
    } catch {
      setRefreshError("Network error — try again");
    } finally {
      setRefreshing(false);
    }
  }

  const raw = profile?.raw_api_response ?? null;
  const ops = carrierOps(raw);

  return (
    <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[#1E1C1A] text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          Carrier profile
          {profile && (
            <span className="text-gray-400 font-normal text-xs">
              · fetched {formatDate(profile.fetched_at)}
            </span>
          )}
        </h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {profile ? "Refresh" : "Fetch from FMCSA"}
        </button>
      </div>

      {refreshError && (
        <p className="text-xs text-[#C67A1E] mb-3">{refreshError}</p>
      )}

      {!profile ? (
        <div className="text-center py-6">
          <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No carrier data on file</p>
          <p className="text-xs text-gray-400 mt-1">Click &quot;Fetch from FMCSA&quot; to pull public carrier data.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Identity */}
          <div>
            <p className="text-lg font-bold text-[#1E1C1A]">
              {profile.legal_name ?? rawField(raw, "legalName")}
            </p>
            {(profile.dba_name || rawField(raw, "dbaName") !== "—") && (
              <p className="text-sm text-gray-500">
                DBA: {profile.dba_name ?? rawField(raw, "dbaName")}
              </p>
            )}
          </div>

          {/* Grid details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {profile.address && (
              <div className="flex items-start gap-2 text-gray-600">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                <span className="text-xs">{profile.address}</span>
              </div>
            )}
            {(profile.phone || rawField(raw, "phyCountry") !== "—") && profile.phone && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="text-xs">{profile.phone}</span>
              </div>
            )}
            {(profile.power_units != null) && (
              <div className="flex items-center gap-2 text-gray-600">
                <Truck className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="text-xs">{profile.power_units} power units</span>
              </div>
            )}
            {(profile.drivers != null) && (
              <div className="flex items-center gap-2 text-gray-600">
                <Users2 className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="text-xs">{profile.drivers} drivers</span>
              </div>
            )}
            {profile.mcs150_date && (
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="text-xs">MCS-150: {formatDate(profile.mcs150_date)}</span>
              </div>
            )}
            {profile.safety_rating && (
              <div className="flex items-center gap-2 text-gray-600">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="text-xs capitalize">Rating: {profile.safety_rating}</span>
              </div>
            )}
          </div>

          {/* Status row */}
          <div className="flex flex-wrap gap-3 pt-1">
            {operatingStatus(raw) !== "—" && (
              <span className="text-xs bg-[#E8F3EC] text-[#3D7A52] px-2 py-0.5 rounded-full font-medium">
                {operatingStatus(raw)}
              </span>
            )}
            {rawField(raw, "entityType") !== "—" && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {rawField(raw, "entityType")}
              </span>
            )}
            {ops.map((op) => (
              <span key={op} className="text-xs bg-[#F5EDDB] text-[#8E7340] px-2 py-0.5 rounded-full">
                {op}
              </span>
            ))}
            {rawField(raw, "hmFlag") === "Y" && (
              <span className="text-xs bg-[#FAECEB] text-[#B83B32] px-2 py-0.5 rounded-full">
                Hazmat
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
