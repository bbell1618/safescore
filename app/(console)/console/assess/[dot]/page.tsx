import { getCarrier, getBasics, getOosRates } from "@/lib/fmcsa/client";
import { ScoreCard } from "@/components/ui/score-card";
import { AddClientForm } from "@/components/console/add-client-form";
import { AlertTriangle, Truck, Users2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AssessPage({
  params,
}: {
  params: Promise<{ dot: string }>;
}) {
  const { dot } = await params;

  let carrier = null;
  let basics = null;
  let oos = null;
  let error: string | null = null;

  try {
    [carrier, basics, oos] = await Promise.all([
      getCarrier(dot),
      getBasics(dot),
      getOosRates(dot),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch carrier data";
  }

  if (error || !carrier) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-[#DC362E] mx-auto mb-3" />
          <p className="font-semibold text-[#DC362E]">Could not fetch carrier data</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <p className="text-xs text-gray-400 mt-3">
            Make sure FMCSA_API_KEY is set, or use DOT 2533650 for the Nationwide mock.
          </p>
        </div>
      </div>
    );
  }

  const basicsArray = [
    { key: "unsafeDriving", label: "Unsafe driving", data: basics?.unsafeDriving },
    { key: "hosCompliance", label: "HOS compliance", data: basics?.hosCompliance },
    { key: "driverFitness", label: "Driver fitness", data: basics?.driverFitness },
    { key: "controlledSubstances", label: "Controlled substances", data: basics?.controlledSubstances },
    { key: "vehicleMaintenance", label: "Vehicle maintenance", data: basics?.vehicleMaintenance },
    { key: "hmCompliance", label: "HM compliance", data: basics?.hmCompliance },
    { key: "crashIndicator", label: "Crash indicator", data: basics?.crashIndicator },
  ];

  const alerts = basicsArray.filter((b) => b.data?.alert).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
          <a href="/console" className="hover:text-[#DC362E]">Clients</a>
          <span>›</span>
          <span>Assessment — DOT {dot}</span>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-bold text-[#1A1A1A]"
            >
              {carrier.legalName}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              DOT {carrier.dotNumber}
              {carrier.mcNumber ? ` · MC ${carrier.mcNumber}` : ""}
              {" · "}
              {carrier.phyCity}, {carrier.phyState}
            </p>
          </div>
          {alerts > 0 && (
            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-4 h-4 text-[#DC362E]" />
              <span className="text-sm font-medium text-[#DC362E]">
                {alerts} BASIC alert{alerts > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Carrier info */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Power units", value: carrier.totalPowerUnits, icon: Truck },
          { label: "Drivers", value: carrier.totalDrivers, icon: Users2 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-3"
          >
            <stat.icon className="w-5 h-5 text-gray-400 shrink-0" />
            <div>
              <p className="text-xl font-bold text-[#1A1A1A]">
                {stat.value}
              </p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* BASICs */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <h2
          className="font-semibold text-[#1A1A1A] text-sm mb-4"
        >
          BASIC scores
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {basicsArray.map((b) => (
            <ScoreCard
              key={b.key}
              label={b.label}
              measure={b.data?.measureValue ?? null}
              percentile={b.data?.percentile ?? null}
              alert={b.data?.alert}
            />
          ))}
        </div>
      </div>

      {/* OOS Rates */}
      {oos && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
          <h2
            className="font-semibold text-[#1A1A1A] text-sm mb-4"
          >
            Out-of-service rates
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Vehicle OOS rate",
                value: oos.vehicleOosRate,
                national: oos.nationalVehicleOosRate,
              },
              {
                label: "Driver OOS rate",
                value: oos.driverOosRate,
                national: oos.nationalDriverOosRate,
              },
              {
                label: "Hazmat OOS rate",
                value: oos.hazmatOosRate,
                national: null,
              },
            ].map((item) => (
              <div key={item.label} className="border border-[#E5E5E5] rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                <p
                  className={`text-2xl font-bold ${
                    item.value !== null && item.national !== null && item.value > item.national
                      ? "text-[#DC362E]"
                      : "text-green-600"
                  }`}
                >
                  {item.value !== null ? `${item.value}%` : "—"}
                </p>
                {item.national !== null && (
                  <p className="text-xs text-gray-400">National avg: {item.national}%</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inspection / crash history note */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <p className="text-sm text-gray-500">
          Detailed inspection and violation history available after running full analysis for enrolled clients.
        </p>
      </div>

      {/* Add as client */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <h2
          className="font-semibold text-[#1A1A1A] text-sm mb-1"
        >
          Add as SafeScore client
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Save this carrier to begin full analysis, DataQs workbench, and client portal setup.
        </p>
        <AddClientForm
          dot={carrier.dotNumber}
          mc={carrier.mcNumber ?? ""}
          name={carrier.legalName}
          city={carrier.phyCity}
          state={carrier.phyState}
          fleetSize={carrier.totalPowerUnits}
          driverCount={carrier.totalDrivers}
        />
      </div>
    </div>
  );
}
