import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendOperationsNotification,
  type EmailDeliveryResult,
  type OperationsNotificationData,
} from "@/lib/email/client";

export type OperationsNotificationEvent =
  | "client_activated"
  | "onboarding_tier_changed"
  | "evidence_uploaded"
  | "intake_question_answered"
  | "monitoring_alert_raised"
  | "compliance_expiration_digest";

export function emailDeliveryMetadata(result: EmailDeliveryResult) {
  return {
    status: result.success
      ? result.dryRun
        ? "dry_run"
        : "sent"
      : "failed",
    dry_run: result.dryRun === true,
    message_id: result.messageId ?? null,
    reason: result.error ?? null,
  };
}

/**
 * Send one fixed-recipient operations notification and always persist its
 * delivery outcome. Callers get a real failure after the failure row exists;
 * no notification path is allowed to degrade silently.
 */
export async function notifyOperations(
  service: SupabaseClient,
  input: {
    clientId: string;
    actorUserId?: string | null;
    event: OperationsNotificationEvent;
    entityType: string;
    entityId: string;
    description: string;
    email: OperationsNotificationData;
    metadata?: Record<string, unknown>;
  }
) {
  const delivery = await sendOperationsNotification(input.email);
  const deliveryMetadata = emailDeliveryMetadata(delivery);
  const { data: activity, error: activityError } = await service
    .from("activity_log")
    .insert({
      client_id: input.clientId,
      user_id: input.actorUserId ?? null,
      action_type: "operations_notification_email",
      entity_type: input.entityType,
      entity_id: input.entityId,
      description: input.description,
      metadata: {
        event: input.event,
        email_trigger: input.email.trigger,
        email_subject: input.email.subject,
        console_url: input.email.consoleUrl,
        email_delivery: deliveryMetadata,
        ...(input.metadata ?? {}),
      },
    })
    .select("id")
    .maybeSingle();

  if (activityError || !activity) {
    throw new Error(
      `Operations notification delivery was attempted, but activity logging failed: ${
        activityError?.message ?? "row was not inserted"
      }`
    );
  }
  if (!delivery.success) {
    throw new Error(
      `Operations notification failed: ${
        delivery.error ?? "unknown delivery failure"
      } (activity ${activity.id})`
    );
  }

  return {
    activityId: activity.id as string,
    delivery,
    emailDelivery: deliveryMetadata,
  };
}
