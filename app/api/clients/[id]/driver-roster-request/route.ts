import { randomUUID } from "node:crypto";
import { sendDriverRosterRequestEmail } from "@/lib/email/client";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

type RouteContext = { params: Promise<{ id: string }> };

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TITLE = "Driver roster & qualification documents";
const REQUEST_DESCRIPTION =
  "Add each driver's name and CDL number, then attach a photo of the CDL and medical card when available. Progress saves as you go.";
const DAY_MS = 86_400_000;

function emailDryRunEnabled() {
  // Match the shared transport's fail-closed default: delivery is suppressed
  // unless production explicitly opts out with EMAIL_DRY_RUN=false.
  return process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false";
}

function routeFailure(error: unknown) {
  if (error instanceof OnboardingRouteFailure) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Unknown driver-list request failure",
      code: "DRIVER_ROSTER_REQUEST_FAILED",
    },
    { status: 500 }
  );
}

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { id: clientId } = await params;
    if (!CLIENT_ID_PATTERN.test(clientId)) {
      return Response.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const dedupeKey = `roster_collection:${clientId}`;
    const [clientResult, recipientResult, existingResult] = await Promise.all([
      service
        .from("clients")
        .select("id, name, email, tier")
        .eq("id", clientId)
        .maybeSingle(),
      service
        .from("users")
        .select("email")
        .eq("client_id", clientId)
        .eq("role", "client_user")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      service
        .from("client_requests")
        .select("id, status, upload_token")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle(),
    ]);
    if (clientResult.error) {
      throw new Error(
        `Unable to load the client for a driver-list request: ${clientResult.error.message}`
      );
    }
    if (!clientResult.data) {
      return Response.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (clientResult.data.tier !== "total_safety") {
      return Response.json(
        {
          error: "Driver-list collection is available only for Total Safety clients.",
          code: "TOTAL_SAFETY_REQUIRED",
        },
        { status: 403 }
      );
    }
    if (recipientResult.error) {
      throw new Error(
        `Unable to load the driver-list email recipient: ${recipientResult.error.message}`
      );
    }
    if (existingResult.error) {
      throw new Error(
        `Unable to check for an existing driver-list request: ${existingResult.error.message}`
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nextReminderAt = new Date(now.getTime() + 7 * DAY_MS).toISOString();
    let created = false;
    let reopened = false;
    let requestRow = existingResult.data;

    if (requestRow && requestRow.status !== "open") {
      const rotatedToken = randomUUID();
      const { data, error } = await service
        .from("client_requests")
        .update({
          status: "open",
          upload_token: rotatedToken,
          submitted_at: null,
          response: null,
          status_copy: null,
          reminder_count: 0,
          last_reminded_at: null,
          next_reminder_at: nextReminderAt,
          escalated_at: null,
          closed_at: null,
          created_by: userId,
          // The row is intentionally reused for dedupe, but each reopened
          // collection cycle needs an honest request date in the checklist.
          created_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", requestRow.id)
        .eq("client_id", clientId)
        .eq("dedupe_key", dedupeKey)
        .neq("status", "open")
        .select("id, status, upload_token")
        .maybeSingle();
      if (error) {
        throw new Error(
          `Unable to reopen the driver-list request: ${error.message}`
        );
      }
      if (data) {
        requestRow = data;
        reopened = true;
      } else {
        const { data: concurrent, error: concurrentError } = await service
          .from("client_requests")
          .select("id, status, upload_token")
          .eq("dedupe_key", dedupeKey)
          .eq("status", "open")
          .maybeSingle();
        if (concurrentError || !concurrent) {
          throw new Error(
            `The driver-list request changed concurrently and could not be reloaded: ${
              concurrentError?.message ?? "open request not found"
            }`
          );
        }
        requestRow = concurrent;
      }
    } else if (!requestRow) {
      const { data, error } = await service
        .from("client_requests")
        .insert({
          client_id: clientId,
          dedupe_key: dedupeKey,
          category: "compliance",
          request_type: "roster_collection",
          source: "standing",
          responsibility: "client",
          title: REQUEST_TITLE,
          description: REQUEST_DESCRIPTION,
          requested_items: [],
          status: "open",
          reminder_count: 0,
          reminder_limit: 3,
          reminder_interval_days: 7,
          next_reminder_at: nextReminderAt,
          created_by: userId,
          updated_at: nowIso,
        })
        .select("id, status, upload_token")
        .maybeSingle();
      if (error && error.code !== "23505") {
        throw new Error(
          `Unable to create the driver-list request: ${error.message}`
        );
      }
      if (data) {
        requestRow = data;
        created = true;
      } else {
        const { data: concurrent, error: concurrentError } = await service
          .from("client_requests")
          .select("id, status, upload_token")
          .eq("dedupe_key", dedupeKey)
          .eq("status", "open")
          .maybeSingle();
        if (concurrentError || !concurrent) {
          throw new Error(
            `The driver-list request conflict could not be resolved: ${
              concurrentError?.message ?? "open request not found"
            }`
          );
        }
        requestRow = concurrent;
      }
    }

    if (!requestRow || requestRow.status !== "open") {
      throw new Error("An open driver-list request was not returned.");
    }
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
    ).replace(/\/+$/, "");
    const rosterUrl = `${baseUrl}/roster/${requestRow.upload_token}`;
    const shouldNotify = created || reopened;
    const recipientEmail =
      recipientResult.data?.email?.trim() ||
      clientResult.data.email?.trim() ||
      null;

    let emailDelivery: {
      status: "dry_run" | "sent" | "failed" | "skipped";
      dryRun: boolean;
      reason?: string;
    };
    if (!shouldNotify) {
      emailDelivery = {
        status: "skipped",
        dryRun: emailDryRunEnabled(),
        reason: "duplicate_open_request",
      };
    } else if (!recipientEmail) {
      emailDelivery = {
        status: "skipped",
        dryRun: emailDryRunEnabled(),
        reason: "no_client_email",
      };
    } else {
      const result = await sendDriverRosterRequestEmail({
        to: recipientEmail,
        companyName: clientResult.data.name,
        rosterUrl,
      });
      emailDelivery = result.success
        ? {
            status: result.dryRun ? "dry_run" : "sent",
            dryRun: result.dryRun === true,
          }
        : {
            status: "failed",
            dryRun: emailDryRunEnabled(),
            reason: result.error ?? "driver_roster_notification_failed",
          };
    }

    if (shouldNotify) {
      const { error: activityError } = await service.from("activity_log").insert({
        client_id: clientId,
        user_id: userId,
        action_type: "client_driver_roster_requested",
        entity_type: "client_requests",
        entity_id: requestRow.id,
        description: reopened
          ? "GEIA reopened the client's driver-list request"
          : "GEIA requested the client's driver list",
        metadata: {
          request_type: "roster_collection",
          request_created: created,
          request_reopened: reopened,
          email_delivery: emailDelivery,
        },
      });
      if (activityError) {
        throw new Error(
          `Driver-list request ${requestRow.id} was saved, but activity logging failed: ${activityError.message}`
        );
      }
    }

    const responseBody = {
      request: {
        id: requestRow.id,
        status: "open" as const,
        created,
        reopened,
      },
      rosterUrl,
      emailDelivery,
    };
    if (emailDelivery.status === "failed") {
      return Response.json(
        {
          ...responseBody,
          error: `The driver-list request was saved, but its notification failed: ${emailDelivery.reason}`,
          code: "DRIVER_ROSTER_REQUEST_EMAIL_FAILED",
        },
        { status: 502 }
      );
    }
    return Response.json(responseBody, { status: created ? 201 : 200 });
  } catch (error) {
    return routeFailure(error);
  }
}
