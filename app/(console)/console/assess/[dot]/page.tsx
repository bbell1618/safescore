import { getCarrier, getBasics, getOosRates } from "@/lib/fmcsa/client";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { ScoreCard } from "@/components/ui/score-card";
import { AddClientForm } from "@/components/console/add-client-form";
import { AlertTriangle, Truck, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

const BASIC_CONTEXT = {
  unsafeDriving: {
    caption: "Higher is worse; thresholds use peer percentiles.",
    tooltip:
      "FMCSA prioritizes Unsafe Driving at or above the percentile threshold for the carrier segment: 50% passenger, 60% HM, 65% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
  hosCompliance: {
    caption: "Higher is worse; thresholds use peer percentiles.",
    tooltip:
      "FMCSA prioritizes HOS Compliance at or above the percentile threshold for the carrier segment: 50% passenger, 60% HM, 65% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
  driverFitness: {
    caption: "Higher is worse; threshold depends on segment.",
    tooltip:
      "FMCSA prioritizes Driver Fitness at or above the percentile threshold for the carrier segment: 65% passenger, 75% HM, 80% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
  controlledSubstances: {
    caption: "Higher is worse; threshold depends on segment.",
    tooltip:
      "FMCSA prioritizes Controlled Substances/Alcohol at or above the percentile threshold for the carrier segment: 65% passenger, 75% HM, 80% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
  vehicleMaintenance: {
    caption: "Higher is worse; threshold depends on segment.",
    tooltip:
      "FMCSA prioritizes Vehicle Maintenance at or above the percentile threshold for the carrier segment: 65% passenger, 75% HM, 80% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
  hmCompliance: {
    caption: "Higher is worse; HM threshold is 80%.",
    tooltip:
      "FMCSA prioritizes HM Compliance at or above the percentile threshold: 80% for passenger, HM, and general carrier segments. Low-volume carriers may show a raw measure without a public percentile.",
  },
  crashIndicator: {
    caption: "Higher is worse; thresholds use peer percentiles.",
    tooltip:
      "FMCSA prioritizes Crash Indicator at or above the percentile threshold for the carrier segment: 50% passenger, 60% HM, 65% general. Low-volume carriers may show a raw measure without a public percentile.",
  },
};

export default async function AssessPage({
  params,
}: {
  params: Promise<{ dot: string }>;
}) {
  const { dot } = await params;

  let existingClient: { id: string; name: string } | null = null;
  let carrier = null;
  let basics = null;
  let oos = null;
  let error: string | null = null;

  try {
    const carrierPromise = getCarrier(dot);
    [carrier, basics, oos, existingClient] = await Promise.all([
      carrierPromise,
      getBasics(dot),
      getOosRates(dot),
      Promise.all([carrierPromise, createClient()]).then(async ([carrier, supabase]) => {
        const { data, error } = await supabase.from("clients").select("id, name").eq("dot_number", carrier.dotNumber).maybeSingle();
        if (error) throw new Error(`Unable to check existing SafeScore clients: ${error.message}`);
        return data;
      }),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch carrier data";
  }

  if (error || !carrier) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-[#C67A1E] mx-auto mb-3" />
          <p className="font-semibold text-[#C67A1E]">Could not fetch carrier data</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <p className="text-xs text-gray-400 mt-3">
            Try the USDOT number again. If this continues, ask your team to check the FMCSA connection.
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
  const burden = existingClient ? await getClientBurden(existingClient.id) : null;
  const hasPublishedPercentile = basicsArray.some(b => b.data?.percentile != null);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="portal-navy-texture rounded-2xl bg-navy p-6 text-warm-white sm:p-8">
        <Link href="/console/assess" className="inline-flex min-h-11 items-center text-sm text-warm-white/75 underline">Assess another carrier</Link>
        <p className="mt-3 font-mono text-xs uppercase tracking-wider text-gold-light">Carrier assessment</p>
        <h1 className="mt-2 break-words font-heading text-3xl sm:text-4xl">{carrier.legalName}</h1>
        <p className="mt-3 font-mono text-sm text-warm-white/75">USDOT {carrier.dotNumber}{carrier.mcNumber ? ` · MC ${carrier.mcNumber}` : ""} · {carrier.phyCity}, {carrier.phyState}</p>
        <div className="mt-6 flex flex-wrap items-end gap-6">
          {burden ? <div><p className="text-xs text-warm-white/70">Current violation burden</p><p className="mt-1 font-heading text-6xl text-amber-light">{burden.totalPoints.toLocaleString()} <span className="font-mono text-sm">weighted points</span></p><p className="mt-2 font-mono text-xs text-warm-white/65">As of {burden.asOf} · SafeScore canonical inspection records</p></div> : <p className="text-sm text-warm-white/75">Violation burden will be available after the carrier&apos;s inspection records are analyzed.</p>}
          {alerts > 0 && <span className="rounded-full bg-amber-subtle px-3 py-2 text-sm text-amber-dark">{alerts} BASIC alert{alerts === 1 ? "" : "s"}</span>}
        </div>
        {!hasPublishedPercentile && <p className="mt-5 text-sm leading-6 text-warm-white/80">FMCSA publishes no percentiles for this carrier. Raw BASIC measures are not percentile rankings.</p>}
      </header>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Power units", value: carrier.totalPowerUnits, icon: Truck },
          { label: "Drivers", value: carrier.totalDrivers, icon: Users2 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-3"
          >
            <stat.icon className="w-5 h-5 text-gray-400 shrink-0" />
            <div>
              <p className="text-xl font-bold text-[#1E1C1A]">
                {stat.value}
              </p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <h2 className="font-semibold text-[#1E1C1A] text-sm mb-4">
          BASIC measures
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {basicsArray.map((b) => (
            <ScoreCard
              key={b.key}
              label={b.label}
              measure={b.data?.measureValue ?? null}
              percentile={b.data?.percentile ?? null}
              alert={b.data?.alert}
              context={BASIC_CONTEXT[b.key as keyof typeof BASIC_CONTEXT]}
            />
          ))}
        </div>
      </div>

      {oos && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm mb-4">
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
                national: oos.nationalHazmatOosRate,
              },
            ].map((item) => (
              <div key={item.label} className="border border-[#F0E8DA] rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                <p
                  className={`text-2xl font-bold ${
                    item.value === null || item.national === null
                      ? "text-gray-500"
                      : item.value > item.national
                        ? "text-[#C67A1E]"
                        : "text-green-600"
                  }`}
                >
                  {item.value !== null ? `${item.value}%` : "\u2014"}
                </p>
                {item.national !== null && (
                  <p className="text-xs text-gray-400">National avg: {item.national}%</p>
                )}
                {item.national === null && (
                  <p className="text-xs text-gray-400">No national benchmark published</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {existingClient ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="text-sm font-semibold text-green-800">Already a client</h2>
          <p className="mt-1 text-xs text-green-700">
            {existingClient.name} is already enrolled. This assessment will not create or change its service tier.
          </p>
          <Link href={`/console/clients/${existingClient.id}`} className="btn-primary mt-4 inline-flex min-h-11 items-center">
            Open file →
          </Link>
        </div>
      ) : (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm mb-1">Add as SafeScore client</h2>
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
      )}
    </div>
  );
}
