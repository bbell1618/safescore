"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type MonitoringAlertRow = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical" | string;
  title: string;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

type AcknowledgeResponse = {
  alert?: {
    id: string;
    client_id: string;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
  };
  error?: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function severityVariant(
  severity: string
): "danger" | "warning" | "info" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function alertTypeLabel(type: string) {
  return type.replaceAll("_", " ");
}

export function MonitoringAlertList({
  initialAlerts,
}: {
  initialAlerts: MonitoringAlertRow[];
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unacknowledged = alerts.filter(
    (alert) => alert.acknowledged_at === null
  ).length;

  async function acknowledge(alertId: string) {
    setPendingId(alertId);
    setError(null);
    try {
      const response = await fetch(
        `/api/monitoring/alerts/${encodeURIComponent(alertId)}/acknowledge`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => ({}))) as AcknowledgeResponse;
      if (!response.ok || !payload.alert?.acknowledged_at) {
        throw new Error(
          payload.error ??
            `Alert acknowledgement failed with HTTP ${response.status}`
        );
      }
      setAlerts((current) =>
        current.map((alert) =>
          alert.id === alertId
            ? {
                ...alert,
                acknowledged_at: payload.alert!.acknowledged_at,
                acknowledged_by: payload.alert!.acknowledged_by,
              }
            : alert
        )
      );
      router.refresh();
    } catch (acknowledgementError) {
      setError(
        acknowledgementError instanceof Error
          ? acknowledgementError.message
          : "Unknown alert acknowledgement failure"
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      aria-labelledby="monitoring-alerts-heading"
      className="overflow-hidden rounded-xl border border-[#E7DDCE] bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0E8DA] bg-[#FBF7F0] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[#C67A1E]" />
            <h2 id="monitoring-alerts-heading" className="text-sm font-semibold text-[#1E1C1A]">
              Monitoring alerts
            </h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Read each alert against the latest snapshot, then acknowledge it.
          </p>
        </div>
        <Badge variant={unacknowledged > 0 ? "danger" : "success"}>
          {unacknowledged} unread
        </Badge>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700"
        >
          Alert acknowledgement failed: {error}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <ul className="divide-y divide-[#F0E8DA]">
          {alerts.map((alert) => {
            const isUnread = alert.acknowledged_at === null;
            const busy = pendingId === alert.id;
            return (
              <li
                key={alert.id}
                className={`px-5 py-4 transition-colors ${
                  isUnread ? "bg-[#FFF9EF]" : "bg-white text-gray-500"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        isUnread
                          ? "bg-[#FDF4E7] text-[#C67A1E]"
                          : "bg-[#E8F3EC] text-[#3D7A52]"
                      }`}
                    >
                      {isUnread ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                          {alertTypeLabel(alert.type)}
                        </span>
                      </div>
                      <h3
                        className={`mt-1.5 text-sm font-semibold ${
                          isUnread ? "text-[#1E1C1A]" : "text-gray-500"
                        }`}
                      >
                        {alert.title}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        {alert.message}
                      </p>
                      <p className="mt-2 text-[11px] text-gray-400">
                        Raised {formatTimestamp(alert.created_at)}
                        {alert.acknowledged_at
                          ? ` · Acknowledged ${formatTimestamp(alert.acknowledged_at)}`
                          : " · Unacknowledged"}
                      </p>
                    </div>
                  </div>

                  {isUnread ? (
                    <button
                      type="button"
                      onClick={() => void acknowledge(alert.id)}
                      disabled={pendingId !== null}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1B2D4F] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2A4270] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {busy ? "Acknowledging…" : "Acknowledge"}
                    </button>
                  ) : (
                    <span className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#BFD8C7] bg-[#F3F8F4] px-3 py-2 text-xs font-medium text-[#315E3E]">
                      <Check className="h-3.5 w-3.5" />
                      Acknowledged
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 py-10 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-[#3D7A52]" />
          <p className="mt-2 text-sm font-medium text-[#1E1C1A]">
            No monitoring alerts recorded.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            New violations, inspections, crashes, and OOS changes appear here.
          </p>
        </div>
      )}
    </section>
  );
}
