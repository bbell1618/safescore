import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendRequestQueueReminder,
  type EmailDeliveryResult,
} from "@/lib/email/client";
import {
  processDueClientRequestReminders,
  type ClientRequestReminderRepository,
  type ClientRequestReminderRunResult,
  type ClientRequestReminderSource,
  type DueClientRequest,
  type ReminderActivity,
  type ReminderClaim,
} from "@/lib/request-queue/reminder-processor";

const PAGE_SIZE = 500;

type DueRequestRow = {
  id: string;
  client_id: string;
  title: string;
  reminder_count: number;
  reminder_limit: number;
  next_reminder_at: string;
  request_type: string | null;
  upload_token: string;
  clients:
    | { name: string; email: string | null }
    | Array<{ name: string; email: string | null }>
    | null;
};

function companyName(row: DueRequestRow) {
  const relation = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  return relation?.name ?? "Your company";
}

function createReminderRepository(
  service: SupabaseClient,
  baseUrl: string
): ClientRequestReminderRepository {
  return {
    async listDue(nowIso) {
      const requests: DueClientRequest[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await service
          .from("client_requests")
          .select(
            "id, client_id, title, reminder_count, reminder_limit, next_reminder_at, request_type, upload_token, clients(name,email)"
          )
          .eq("status", "open")
          .eq("responsibility", "client")
          .not("next_reminder_at", "is", null)
          .lte("next_reminder_at", nowIso)
          .order("next_reminder_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          throw new Error(`Unable to load due client requests: ${error.message}`);
        }
        const page = (data ?? []) as unknown as DueRequestRow[];
        requests.push(
          ...page.map((row) => ({
            id: row.id,
            clientId: row.client_id,
            companyName: companyName(row),
            title: row.title,
            reminderCount: row.reminder_count,
            reminderLimit: row.reminder_limit,
            nextReminderAt: row.next_reminder_at,
            ...(row.request_type === "roster_collection"
              ? {
                  portalUrl: `${baseUrl}/roster/${row.upload_token}`,
                  // Bearer tokens must not be persisted in activity metadata.
                  activityPortalUrl: `${baseUrl}/roster/[redacted]`,
                  fallbackRecipientEmail: (
                    Array.isArray(row.clients) ? row.clients[0] : row.clients
                  )?.email ?? undefined,
                }
              : {}),
          }))
        );
        if (page.length < PAGE_SIZE) break;
      }
      return requests;
    },

    async recipientFor(clientId) {
      const { data, error } = await service
        .from("users")
        .select("email")
        .eq("client_id", clientId)
        .eq("role", "client_user")
        .not("email", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(
          `Unable to load client reminder recipient: ${error.message}`
        );
      }
      return data?.email ? { email: data.email as string } : null;
    },

    async claim(claim: ReminderClaim) {
      // reminder_count is the compare-and-update idempotency boundary. Only
      // one invocation can reserve a given request/reminder ordinal.
      const { data, error } = await service
        .from("client_requests")
        .update({
          reminder_count: claim.reminderNumber,
          last_reminded_at: claim.nowIso,
          next_reminder_at: claim.nextReminderAt,
          escalated_at: claim.escalatedAt,
          updated_at: claim.nowIso,
        })
        .eq("id", claim.requestId)
        .eq("status", "open")
        .eq("responsibility", "client")
        .eq("reminder_count", claim.expectedReminderCount)
        .lte("next_reminder_at", claim.dueThrough)
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(
          `Unable to claim client request reminder: ${error.message}`
        );
      }
      return Boolean(data);
    },

    async stopExhausted(input) {
      const { data, error } = await service
        .from("client_requests")
        .update({
          next_reminder_at: null,
          escalated_at: input.nowIso,
          updated_at: input.nowIso,
        })
        .eq("id", input.requestId)
        .eq("status", "open")
        .eq("responsibility", "client")
        .eq("reminder_count", input.expectedReminderCount)
        .lte("next_reminder_at", input.dueThrough)
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(
          `Unable to stop exhausted client request reminders: ${error.message}`
        );
      }
      return Boolean(data);
    },

    async logActivity(activity: ReminderActivity) {
      const { data, error } = await service
        .from("activity_log")
        .insert({
          client_id: activity.clientId,
          action_type: "client_request_reminder_email",
          entity_type: "client_requests",
          entity_id: activity.requestId,
          description: `Client request reminder ${activity.reminderNumber} of ${activity.reminderLimit} ${activity.deliveryStatus}: ${activity.requestTitle}`,
          metadata: {
            source: activity.source,
            trigger: "request_queue_reminder",
            request_id: activity.requestId,
            reminder_number: activity.reminderNumber,
            reminder_limit: activity.reminderLimit,
            idempotency_key: activity.idempotencyKey,
            next_reminder_at: activity.nextReminderAt,
            escalated: activity.escalated,
            recipient: activity.recipient,
            email_subject: activity.subject,
            portal_url: activity.portalUrl,
            email_delivery: {
              status: activity.deliveryStatus,
              dry_run: activity.delivery.dryRun === true,
              message_id: activity.delivery.messageId ?? null,
              reason: activity.delivery.error ?? null,
            },
          },
        })
        .select("id")
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          `Unable to log client request reminder: ${
            error?.message ?? "activity row was not inserted"
          }`
        );
      }
      return data.id as string;
    },
  };
}

export async function runDueClientRequestReminders(
  service: SupabaseClient,
  input: {
    now?: Date;
    source: ClientRequestReminderSource;
  }
): Promise<ClientRequestReminderRunResult> {
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
  ).replace(/\/+$/, "");
  const portalUrl = `${baseUrl}/portal/documents#needed-from-you`;
  return processDueClientRequestReminders(createReminderRepository(service, baseUrl), {
    now: input.now ?? new Date(),
    source: input.source,
    portalUrl,
    sendReminder: async (emailInput): Promise<EmailDeliveryResult> =>
      sendRequestQueueReminder(emailInput),
  });
}
