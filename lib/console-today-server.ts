import "server-only";
import { responseClock } from "@/lib/cases/agency-request-clock";
import { createServiceClient } from "@/lib/supabase/server";
import { assembleClientWorkContext, systemGateContextFromEnvironment } from "@/lib/operator/checklist-server";
import { evaluateChecklist, evaluateSystemGates } from "@/lib/operator/checklist-rules";
import { isSubscriptionTier } from "@/lib/tiers";
import type { ChecklistItem, OperatorWorkContext } from "@/lib/operator/checklist-types";

function itemTiming(context: OperatorWorkContext, item: ChecklistItem) {
  const request = context.agencyRequests.find(row => row.id === item.contextKey);
  if (request) {
    const { daysLeft } = responseClock(request, context.now);
    return daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`;
  }
  const record = context.cases.find(value => item.contextKey.includes(value.id));
  const requests = context.requests.filter(value =>
    value.status === "open" && value.responsibility === "client" &&
    (value.requestType === "evidence" || value.requestType === "question") &&
    (item.ruleKey === "evidence.submitted" ? value.evidenceStatus === "submitted" : value.evidenceStatus !== "submitted") &&
    (item.ruleKey === "evidence.escalated" ? value.escalatedAt !== null : item.ruleKey === "evidence.waiting" ? value.escalatedAt === null : true)
  );
  const dates = item.family === "cases" && record ? [record.filedDate ?? record.createdAt]
    : item.family === "monitoring" ? context.alerts.filter(value => !value.acknowledgedAt).map(value => value.createdAt)
    : item.family === "evidence" ? requests.map(value => value.createdAt)
    : [];
  const oldest = dates.sort()[0];
  if (oldest) return `${Math.max(0, Math.floor((new Date(context.now).getTime() - new Date(oldest).getTime()) / 86400000))}d old`;
  if (item.state === "waiting_gate") return "Blocked";
  if (item.state === "waiting_client") return "Waiting on client";
  return "Due now";
}

/** Read-only presentation data; derived rules and existing state remain authoritative. */
export async function loadConsoleToday() {
  const service = await createServiceClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [clientsResult, alertsResult, requestsResult, activityResult, unreadResult] = await Promise.all([
    service.from("clients").select("id, name, tier, status", { count: "exact" }).order("name").range(0, 999),
    service.from("alerts").select("id, client_id, title, message, created_at, read_at", { count: "exact" }).is("dismissed_at", null).gte("created_at", since).order("created_at", { ascending: false }).range(0, 999),
    service.from("client_requests").select("id, client_id, title, created_at, due_at", { count: "exact" }).eq("status", "open").eq("responsibility", "client").order("created_at").range(0, 999),
    service.from("activity_log").select("id, description, created_at").order("created_at", { ascending: false }).limit(8),
    service.from("alerts").select("id", { count: "exact", head: true }).is("dismissed_at", null).is("read_at", null),
  ]);
  if (unreadResult.error) throw new Error(`Unable to load unread alerts: ${unreadResult.error.message}`);
  for (const [label, result] of [["clients", clientsResult], ["alerts", alertsResult], ["requests", requestsResult], ["activity", activityResult]] as const) {
    if (result.error) throw new Error(`Unable to load Today ${label}: ${result.error.message}`);
    if (result.count != null && result.count > (result.data?.length ?? 0)) throw new Error(`Unable to load complete Today ${label}: ${result.count} rows exceed the loaded result`);
  }
  const clients = clientsResult.data ?? [];
  const contexts = await Promise.all(clients.filter(client => client.status === "active" && isSubscriptionTier(client.tier)).map(client => assembleClientWorkContext(client.id, { service })));
  return {
    now: new Date().getTime(),
    unreadAlertCount: unreadResult.count ?? 0,
    clients,
    groups: contexts.map(context => ({
      client: context.client,
      burden: context.snapshots[0]?.totalPoints ?? null,
      items: evaluateChecklist(context).map(item => ({
        ...item,
        timing: itemTiming(context, item),
        href: item.canMarkDone || item.action
          ? `/console/clients/${context.client.id}/work#work-item-${encodeURIComponent(item.id)}`
          : item.href || `/console/clients/${context.client.id}/work#requests`,
      })),
      manualItems: context.manualItems.filter(item => item.status === "open" && !item.deletedAt),
    })).sort((a, b) => Number(b.items.some(item => item.priority === 0)) - Number(a.items.some(item => item.priority === 0))),
    alerts: [...(alertsResult.data ?? [])].sort((a, b) => Number(a.read_at !== null) - Number(b.read_at !== null)),
    requests: requestsResult.data ?? [], activity: activityResult.data ?? [],
    gates: evaluateSystemGates(systemGateContextFromEnvironment()),
  };
}
