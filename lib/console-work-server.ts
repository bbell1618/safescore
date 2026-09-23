import "server-only";
import { assembleClientWorkContext } from "@/lib/operator/checklist-server";
import { evaluateChecklist } from "@/lib/operator/checklist-rules";
import { createServiceClient } from "@/lib/supabase/server";
import type { ClientWorkData } from "./console-work-types";

export async function loadClientWork(clientId: string): Promise<ClientWorkData> {
  const service = await createServiceClient();
  const [context, requests, alerts] = await Promise.all([
    assembleClientWorkContext(clientId, { service }),
    service.from("client_requests").select("id,title,description,created_at,due_at,request_type,upload_token,reminder_count,reminder_limit,next_reminder_at,escalated_at").eq("client_id", clientId).eq("status", "open").eq("responsibility", "client").order("created_at"),
    service.from("alerts").select("id,title,message,severity,created_at,acknowledged_at").eq("client_id", clientId).is("dismissed_at", null).is("acknowledged_at", null).order("created_at"),
  ]);
  if (requests.error) throw new Error(`Unable to load work requests: ${requests.error.message}`);
  if (alerts.error) throw new Error(`Unable to load work alerts: ${alerts.error.message}`);
  const items = evaluateChecklist(context);
  const timing: ClientWorkData["timing"] = {};
  for (const item of items) {
    const agencyRequest = context.agencyRequests.find(row => row.id === item.contextKey);
    const caseRow = context.cases.find(row => item.contextKey.includes(row.id));
    const relatedRequests = (requests.data ?? []).filter(row => item.contextKey.includes(row.id) || (item.family === "evidence" && (item.ruleKey === "evidence.escalated" ? row.escalated_at : item.ruleKey === "evidence.waiting" ? !row.escalated_at : true)));
    const dates = relatedRequests.map(row => row.created_at);
    if (caseRow) dates.push(caseRow.createdAt);
    if (item.family === "monitoring") dates.push(...(alerts.data ?? []).map(row => row.created_at));
    if (agencyRequest) {
      timing[item.id] = { createdAt: agencyRequest.created_at, dueAt: agencyRequest.response_due };
      continue;
    }
    timing[item.id] = { createdAt: dates.sort()[0] ?? null, dueAt: relatedRequests.map(row => row.due_at).filter((date): date is string => !!date).sort()[0] ?? null };
  }
  return { items, manualItems: context.manualItems, requests: requests.data ?? [], alerts: alerts.data ?? [], timing, lastRefresh: context.snapshots[0]?.capturedAt ?? null, now: context.now, appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app").replace(/\/+$/, "") };
}
