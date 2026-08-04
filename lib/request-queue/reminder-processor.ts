export const MAX_CLIENT_REQUEST_REMINDERS = 3;
export const CLIENT_REQUEST_REMINDER_INTERVAL_DAYS = 7;

const DAY_MS = 86_400_000;

export type ClientRequestReminderSource = "monitoring_cron" | "staff_route";

export type DueClientRequest = {
  id: string;
  clientId: string;
  companyName: string;
  title: string;
  reminderCount: number;
  reminderLimit: number;
  nextReminderAt: string;
};

export type ClientReminderRecipient = {
  email: string;
};

export type ReminderDeliveryResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  dryRun?: boolean;
};

export type ReminderActivity = {
  clientId: string;
  requestId: string;
  requestTitle: string;
  reminderNumber: number;
  reminderLimit: number;
  nextReminderAt: string | null;
  escalated: boolean;
  idempotencyKey: string;
  source: ClientRequestReminderSource;
  recipient: string;
  subject: string;
  portalUrl: string;
  delivery: ReminderDeliveryResult;
  deliveryStatus: "dry_run" | "sent" | "failed";
};

export type ReminderClaim = {
  requestId: string;
  expectedReminderCount: number;
  dueThrough: string;
  reminderNumber: number;
  nextReminderAt: string | null;
  escalatedAt: string | null;
  nowIso: string;
};

export interface ClientRequestReminderRepository {
  listDue(nowIso: string): Promise<DueClientRequest[]>;
  recipientFor(clientId: string): Promise<ClientReminderRecipient | null>;
  claim(claim: ReminderClaim): Promise<boolean>;
  stopExhausted(input: {
    requestId: string;
    expectedReminderCount: number;
    dueThrough: string;
    nowIso: string;
  }): Promise<boolean>;
  logActivity(activity: ReminderActivity): Promise<string>;
}

export type ReminderEmailInput = {
  to: string;
  companyName: string;
  requestTitle: string;
  reminderNumber: number;
  reminderLimit: number;
  portalUrl: string;
};

export type ReminderEmailSender = (
  input: ReminderEmailInput
) => Promise<ReminderDeliveryResult>;

export type ClientRequestReminderResult = {
  requestId: string;
  clientId: string;
  reminderNumber: number | null;
  status: "succeeded" | "failed" | "skipped";
  deliveryStatus: "dry_run" | "sent" | "failed" | null;
  activityId: string | null;
  nextReminderAt: string | null;
  escalated: boolean;
  reason: string | null;
};

export type ClientRequestReminderRunResult = {
  due: number;
  processed: number;
  sent: number;
  dryRun: number;
  failed: number;
  skipped: number;
  results: ClientRequestReminderResult[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function effectiveReminderLimit(request: DueClientRequest) {
  return Math.min(
    MAX_CLIENT_REQUEST_REMINDERS,
    Math.max(1, request.reminderLimit)
  );
}

function deliveryStatus(
  delivery: ReminderDeliveryResult
): ReminderActivity["deliveryStatus"] {
  if (!delivery.success) return "failed";
  return delivery.dryRun ? "dry_run" : "sent";
}

/**
 * Process reminders from any scheduler without duplicating an ordinal.
 *
 * The repository's conditional claim increments reminder_count before the
 * transport call. That at-most-once boundary means concurrent cron runs and
 * retries cannot emit the same (request, reminder number). A transport failure
 * is still an attempted reminder: it is logged, consumes that ordinal, and is
 * surfaced to the caller instead of silently retrying a possibly delivered
 * email.
 */
export async function processDueClientRequestReminders(
  repository: ClientRequestReminderRepository,
  input: {
    now: Date;
    source: ClientRequestReminderSource;
    portalUrl: string;
    sendReminder: ReminderEmailSender;
  }
): Promise<ClientRequestReminderRunResult> {
  const nowIso = input.now.toISOString();
  const due = await repository.listDue(nowIso);
  const recipientCache = new Map<
    string,
    Promise<ClientReminderRecipient | null>
  >();
  const results: ClientRequestReminderResult[] = [];

  for (const request of due) {
    const reminderLimit = effectiveReminderLimit(request);
    if (request.reminderCount >= reminderLimit) {
      const stopped = await repository.stopExhausted({
        requestId: request.id,
        expectedReminderCount: request.reminderCount,
        dueThrough: nowIso,
        nowIso,
      });
      results.push({
        requestId: request.id,
        clientId: request.clientId,
        reminderNumber: null,
        status: "skipped",
        deliveryStatus: null,
        activityId: null,
        nextReminderAt: null,
        escalated: stopped,
        reason: stopped ? "reminder_limit_already_reached" : "not_claimed",
      });
      continue;
    }

    let recipientPromise = recipientCache.get(request.clientId);
    if (!recipientPromise) {
      recipientPromise = repository.recipientFor(request.clientId);
      recipientCache.set(request.clientId, recipientPromise);
    }

    let recipient: ClientReminderRecipient | null;
    try {
      recipient = await recipientPromise;
    } catch (error) {
      results.push({
        requestId: request.id,
        clientId: request.clientId,
        reminderNumber: null,
        status: "failed",
        deliveryStatus: null,
        activityId: null,
        nextReminderAt: request.nextReminderAt,
        escalated: false,
        reason: `Unable to load reminder recipient: ${errorMessage(error)}`,
      });
      continue;
    }
    if (!recipient?.email) {
      results.push({
        requestId: request.id,
        clientId: request.clientId,
        reminderNumber: null,
        status: "failed",
        deliveryStatus: null,
        activityId: null,
        nextReminderAt: request.nextReminderAt,
        escalated: false,
        reason: "No client portal user email is available",
      });
      continue;
    }

    const reminderNumber = request.reminderCount + 1;
    const escalated = reminderNumber >= reminderLimit;
    const nextReminderAt = escalated
      ? null
      : new Date(
          input.now.getTime() +
            CLIENT_REQUEST_REMINDER_INTERVAL_DAYS * DAY_MS
        ).toISOString();
    const claimed = await repository.claim({
      requestId: request.id,
      expectedReminderCount: request.reminderCount,
      dueThrough: nowIso,
      reminderNumber,
      nextReminderAt,
      escalatedAt: escalated ? nowIso : null,
      nowIso,
    });
    if (!claimed) {
      results.push({
        requestId: request.id,
        clientId: request.clientId,
        reminderNumber,
        status: "skipped",
        deliveryStatus: null,
        activityId: null,
        nextReminderAt: request.nextReminderAt,
        escalated: false,
        reason: "not_claimed",
      });
      continue;
    }

    let delivery: ReminderDeliveryResult;
    try {
      delivery = await input.sendReminder({
        to: recipient.email,
        companyName: request.companyName,
        requestTitle: request.title,
        reminderNumber,
        reminderLimit,
        portalUrl: input.portalUrl,
      });
    } catch (error) {
      delivery = { success: false, error: errorMessage(error) };
    }

    const status = deliveryStatus(delivery);
    const subject = `SafeScore request reminder: ${request.title}`;
    let activityId: string | null = null;
    let reason = delivery.success
      ? null
      : delivery.error ?? "Reminder delivery failed";
    try {
      activityId = await repository.logActivity({
        clientId: request.clientId,
        requestId: request.id,
        requestTitle: request.title,
        reminderNumber,
        reminderLimit,
        nextReminderAt,
        escalated,
        idempotencyKey: `${request.id}:reminder:${reminderNumber}`,
        source: input.source,
        recipient: recipient.email,
        subject,
        portalUrl: input.portalUrl,
        delivery,
        deliveryStatus: status,
      });
    } catch (error) {
      reason = `Reminder ${status}, but activity logging failed: ${errorMessage(
        error
      )}`;
    }

    const succeeded = delivery.success && activityId !== null;
    results.push({
      requestId: request.id,
      clientId: request.clientId,
      reminderNumber,
      status: succeeded ? "succeeded" : "failed",
      deliveryStatus: status,
      activityId,
      nextReminderAt,
      escalated,
      reason,
    });
  }

  return {
    due: due.length,
    processed: results.filter((result) => result.deliveryStatus !== null).length,
    sent: results.filter((result) => result.deliveryStatus === "sent").length,
    dryRun: results.filter((result) => result.deliveryStatus === "dry_run")
      .length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
