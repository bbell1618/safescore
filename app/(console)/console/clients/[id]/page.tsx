import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import { ScoreCard } from "@/components/ui/score-card";
import { Badge } from "@/components/ui/badge";
import { ClientDetailTabs } from "@/components/console/client-detail-tabs";
import {
  Building2,
  Truck,
  Users2,
  Calendar,
  MapPin,
  Phone,
  Mail,
  ChevronRight,
} from "lucide-react";
import { InviteButton } from "@/components/console/invite-button";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  // Fetch latest score snapshot
  const { data: snapshot } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("client_id", id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  // Fetch counts
  const [
    { count: violationCount },
    { count: caseCount },
    { count: crashCount },
    { count: alertCount },
  ] = await Promise.all([
    supabase.from("violations").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("dataq_cases").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("crashes").select("*", { count: "exact", head: true }).eq("client_id", id),
    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("client_id", id).is("dismissed_at", null),
  ]);

  // Recent active cases
  const { data: activeCases } = await supabase
    .from("dataq_cases")
    .select("*, violations(violation_code, violation_description)")
    .eq("client_id", id)
    .not("status", "in", '("approved","denied","closed")')
    .order("created_at", { ascending: false })
    .limit(5);

  const basicsArray = snapshot
    ? [
        { key: "unsafeDriving", label: "Unsafe driving", measure: snapshot.unsafe_driving_measure, percentile: snapshot.unsafe_driving_pct },
        { key: "hosCompliance", label: "HOS compliance", measure: snapshot.hos_compliance_measure, percentile: snapshot.hos_compliance_pct },
        { key: "driverFitness", label: "Driver fitness", measure: snapshot.driver_fitness_measure, percentile: snapshot.driver_fitness_pct },
        { key: "controlledSubstance", label: "Controlled substances", measure: snapshot.controlled_substance_measure, percentile: snapshot.controlled_substance_pct },
        { key: "vehicleMaint", label: "Vehicle maintenance", measure: snapshot.vehicle_maint_measure, percentile: snapshot.vehicle_maint_pct },
        { key: "hmCompliance", label: "HM compliance", measure: snapshot.hm_compliance_measure, percentile: snapshot.hm_compliance_pct },
        { key: "crashIndicator", label: "Crash indicator", measure: snapshot.crash_indicator_measure, percentile: snapshot.crash_indicator_pct },
      ]
    : [];

  const tierLabel: Record<string, string> = {
    monitor: "Monitor",
    remediate: "Remediate",
    total_safety: "Total Safety",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#DC362E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1A1A1A] font-medium">{client.name}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1
                className="text-xl font-bold text-[#1A1A1A]"
               
              >
                {client.name}
              </h1>
              {client.tier && (
                <Badge variant={client.tier === "total_safety" ? "gold" : client.tier === "remediate" ? "info" : "default"}>
                  {tierLabel[client.tier]}
                </Badge>
              )}
              <Badge variant={client.status === "active" ? "success" : client.status === "prospect" ? "warning" : "default"}>
                {client.status}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                DOT {client.dot_number}
                {client.mc_number ? ` · MC ${client.mc_number}` : ""}
              </span>
              {(client.city || client.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {client.city}, {client.state}
                </span>
              )}
              {client.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" />
                  {client.phone}
                </span>
              )}
              {client.email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  {client.email}
                </span>
              )}
              {client.fleet_size && (
                <span className="flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" />
                  {client.fleet_size} power units
                </span>
              )}
              {client.driver_count && (
                <span className="flex items-center gap-1">
                  <Users2 className="w-3.5 h-3.5" />
                  {client.driver_count} drivers
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Added {formatDate(client.created_at)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0">
            <InviteButton clientId={id} clientName={client.name} />
            <Link
              href={`/console/clients/${id}/violations`}
              className="px-3 py-1.5 text-xs font-medium border border-[#E5E5E5] rounded-lg hover:border-[#DC362E] hover:text-[#DC362E] transition-colors"
            >
              Violations ({violationCount ?? 0})
            </Link>
            <Link
              href={`/console/clients/${id}/dataq`}
              className="px-3 py-1.5 text-xs font-medium bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors"
             
            >
              DataQs ({caseCount ?? 0})
            </Link>
          </div>
        </div>
      </div>

      {/* Score snapshot */}
      {basicsArray.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2
              className="font-semibold text-[#1A1A1A] text-sm"
             
            >
              BASIC scores
              {snapshot && (
                <span className="text-gray-400 font-normal text-xs ml-2">
                  as of {formatDate(snapshot.snapshot_date)}
                </span>
              )}
            </h2>
            <Link
              href={`/console/assess/${client.dot_number}`}
              className="text-xs text-[#DC362E] hover:underline"
            >
              Re-run analysis
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {basicsArray.map((b) => (
              <ScoreCard
                key={b.key}
                label={b.label}
                measure={b.measure as number | null}
                percentile={b.percentile as number | null}
                alert={(b.percentile as number | null) !== null && (b.percentile as number) >= 80}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick stats + active cases */}
      <div className="grid grid-cols-3 gap-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 content-start">
          {[
            { label: "Violations", value: violationCount ?? 0, href: `violations` },
            { label: "DataQs cases", value: caseCount ?? 0, href: `dataq` },
            { label: "Crashes", value: crashCount ?? 0, href: `cpdp` },
            { label: "Active alerts", value: alertCount ?? 0, href: null },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-xl border border-[#E5E5E5] p-4"
            >
              <p className="text-2xl font-bold text-[#1A1A1A]">
                {s.value}
              </p>
              {s.href ? (
                <Link
                  href={`/console/clients/${id}/${s.href}`}
                  className="text-xs text-[#DC362E] hover:underline"
                >
                  {s.label}
                </Link>
              ) : (
                <p className="text-xs text-gray-500">{s.label}</p>
              )}
            </div>
          ))}
        </div>

        {/* Active cases */}
        <div className="col-span-2 bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
            <h3
              className="font-semibold text-[#1A1A1A] text-sm"
             
            >
              Active cases
            </h3>
            <Link
              href={`/console/clients/${id}/dataq`}
              className="text-xs text-[#DC362E] hover:underline"
            >
              View all
            </Link>
          </div>
          {activeCases && activeCases.length > 0 ? (
            <div className="divide-y divide-[#E5E5E5]">
              {activeCases.map((c) => (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">
                      {Array.isArray(c.violations)
                        ? `${(c.violations as { violation_code: string }[])[0]?.violation_code}`
                        : (c.violations as { violation_code: string } | null)?.violation_code ?? "—"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {Array.isArray(c.violations)
                        ? (c.violations as { violation_description: string }[])[0]?.violation_description
                        : (c.violations as { violation_description: string } | null)?.violation_description ?? ""}
                    </p>
                  </div>
                  <Badge variant={caseStatusVariant(c.status)}>
                    {caseStatusLabel(c.status)}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No active cases</p>
              <Link
                href={`/console/clients/${id}/violations`}
                className="text-xs text-[#DC362E] hover:underline mt-1 inline-block"
              >
                Analyze violations to create cases
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Detail tabs */}
      <ClientDetailTabs clientId={id} dotNumber={client.dot_number} />
    </div>
  );
}
