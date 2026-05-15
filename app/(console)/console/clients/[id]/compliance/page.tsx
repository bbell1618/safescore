import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate, daysUntil } from "@/lib/utils";
import { ChevronRight, User, Truck, AlertTriangle, CheckCircle } from "lucide-react";
import { AddDriverButton, AddVehicleButton } from "@/components/console/compliance-add-forms";

export const dynamic = "force-dynamic";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clientData } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  const client = clientData;
  if (!client) notFound();

  const { data: drivers } = await supabase
    .from("drivers")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("full_name");

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("unit_number");

  const mockAuditAreas = [
    { area: "Parts and Accessories", status: "needs_review" },
    { area: "Driver Qualifications", status: "needs_review" },
    { area: "Operational Requirements", status: "ok" },
    { area: "Hours of Service", status: "needs_review" },
    { area: "Vehicle Inspection, Repair, and Maintenance", status: "needs_review" },
    { area: "Hazardous Materials", status: "ok" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#C67A1E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#C67A1E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">Compliance manager</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold text-[#1E1C1A]"
          >
            Compliance manager
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tier 3 — driver qualifications, fleet maintenance, and compliance audit framework
          </p>
        </div>
        {client.tier !== "total_safety" && (
          <Badge variant="warning">Tier 3 only</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Driver roster */}
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" />
              <h2
                className="font-semibold text-[#1E1C1A] text-sm"
              >
                Driver roster ({drivers?.length ?? 0})
              </h2>
            </div>
            <AddDriverButton clientId={id} />
          </div>
          {drivers && drivers.length > 0 ? (
            <div className="divide-y divide-[#F0E8DA]">
              {drivers.map((d) => {
                const cdlDays = daysUntil(d.cdl_expiry);
                const medDays = daysUntil(d.medical_cert_expiry);
                const hasExpiring = (cdlDays !== null && cdlDays <= 60) || (medDays !== null && medDays <= 60);
                return (
                  <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#1E1C1A]">{d.full_name}</p>
                      <p className="text-xs text-gray-400">
                        CDL exp: {formatDate(d.cdl_expiry)} · Med cert: {formatDate(d.medical_cert_expiry)}
                      </p>
                    </div>
                    {hasExpiring ? (
                      <AlertTriangle className="w-4 h-4 text-[#DAA520]" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No drivers added</p>
              <p className="text-xs text-gray-400 mt-1">Add drivers to track DQF compliance.</p>
            </div>
          )}
        </div>

        {/* Vehicle fleet */}
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-gray-400" />
              <h2
                className="font-semibold text-[#1E1C1A] text-sm"
              >
                Vehicle fleet ({vehicles?.length ?? 0})
              </h2>
            </div>
            <AddVehicleButton clientId={id} />
          </div>
          {vehicles && vehicles.length > 0 ? (
            <div className="divide-y divide-[#F0E8DA]">
              {vehicles.map((v) => (
                <div key={v.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#1E1C1A]">
                      Unit {v.unit_number ?? "—"} · {v.year} {v.make} {v.model}
                    </p>
                    <p className="text-xs text-gray-400">
                      VIN: {v.vin ?? "—"} · {v.license_plate} {v.plate_state}
                    </p>
                  </div>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No vehicles added</p>
            </div>
          )}
        </div>
      </div>

      {/* Mock audit checklist */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <h2
          className="font-semibold text-[#1E1C1A] text-sm mb-4"
        >
          Mock compliance review — 6 FMCSA audit areas
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {mockAuditAreas.map((area) => (
            <div
              key={area.area}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                area.status === "ok"
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              {area.status === "ok" ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#DAA520] shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-[#1E1C1A]">{area.area}</p>
                <p className="text-xs text-gray-500">
                  {area.status === "ok" ? "Passing" : "Needs review"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          Full mock audit requires driver and vehicle data. Add drivers and vehicles above to generate a complete readiness report.
        </p>
      </div>
    </div>
  );
}
