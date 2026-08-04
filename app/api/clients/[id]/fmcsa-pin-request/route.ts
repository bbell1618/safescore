import { NextResponse } from "next/server";
import { sendFmcsaPinRequestEmail } from "@/lib/email/client";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

type RouteContext = { params: Promise<{ id: string }> };

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_CATEGORY = "fmcsa_portal_pin";
const REQUEST_TITLE = "FMCSA Portal PIN needed";
const REQUEST_DESCRIPTION =
  "Log in to ai.fmcsa.dot.gov and look under profile settings for your FMCSA Portal PIN. Do not send the PIN through ordinary email.";
const REQUEST_STATUS_COPY =
  "Secure online PIN handoff is not available yet. Contact your Golden Era SafeScore team for a secure handoff.";

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!CLIENT_ID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const [clientResult, recipientResult, pinResult, existingResult] =
      await Promise.all([
        service
          .from("clients")
          .select("id, name, email")
          .eq("id", id)
          .maybeSingle(),
        service
          .from("users")
          .select("email")
          .eq("client_id", id)
          .eq("role", "client_user")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        service
          .from("client_credentials")
          .select("id", { count: "exact", head: true })
          .eq("client_id", id)
          .not("fmcsa_pin_encrypted", "is", null),
        service
          .from("client_requests")
          .select("id, status")
          .eq("dedupe_key", `${id}:${REQUEST_CATEGORY}`)
          .maybeSingle(),
      ]);

    if (clientResult.error) {
      throw new Error(
        `Unable to load client for PIN request: ${clientResult.error.message}`
      );
    }
    if (!clientResult.data) {
      return NextResponse.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (recipientResult.error) {
      throw new Error(
        `Unable to load PIN-request recipient: ${recipientResult.error.message}`
      );
    }
    if (pinResult.error) {
      throw new Error(
        `Unable to verify FMCSA Portal PIN status: ${pinResult.error.message}`
      );
    }
    if (existingResult.error) {
      throw new Error(
        `Unable to verify existing PIN request: ${existingResult.error.message}`
      );
    }
    if ((pinResult.count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "An FMCSA Portal PIN is already on file.",
          code: "PIN_ALREADY_ON_FILE",
        },
        { status: 409 }
      );
    }

    const recipientEmail =
      recipientResult.data?.email?.trim() ||
      clientResult.data.email?.trim() ||
      null;
    if (!recipientEmail) {
      return NextResponse.json(
        {
          error:
            "The client has no portal-user or account email for the PIN request notification.",
          code: "CLIENT_EMAIL_REQUIRED",
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const nextReminderAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: requestRow, error: requestError } = await service
      .from("client_requests")
      .upsert(
        {
          client_id: id,
          dedupe_key: `${id}:${REQUEST_CATEGORY}`,
          category: REQUEST_CATEGORY,
          title: REQUEST_TITLE,
          description: REQUEST_DESCRIPTION,
          why_copy:
            "GEIA needs the PIN for the FMCSA data work the carrier has authorized.",
          status_copy: REQUEST_STATUS_COPY,
          requested_items: [],
          request_type: null,
          evidence_status: null,
          responsibility: "client",
          source: "standing",
          status: "open",
          next_reminder_at: nextReminderAt,
          closed_at: null,
          created_by: userId,
          updated_at: now.toISOString(),
        },
        { onConflict: "dedupe_key" }
      )
      .select("id, status")
      .single();
    if (requestError || !requestRow) {
      throw new Error(
        `Unable to create FMCSA Portal PIN request: ${
          requestError?.message ?? "row not returned"
        }`
      );
    }

    const portalUrl = `${
      process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
    }/portal/documents#needed-from-you`;
    const emailResult = await sendFmcsaPinRequestEmail({
      to: recipientEmail,
      companyName: clientResult.data.name,
      portalUrl,
    });
    const emailDelivery = emailResult.success
      ? {
          status: emailResult.dryRun ? "dry_run" : "sent",
          dry_run: emailResult.dryRun === true,
        }
      : {
          status: "failed",
          dry_run:
            process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false",
          reason: emailResult.error ?? "pin_request_notification_failed",
        };

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: id,
      user_id: userId,
      action_type: "fmcsa_pin_requested",
      entity_type: "client_requests",
      entity_id: requestRow.id,
      description: "GEIA requested the client's FMCSA Portal PIN",
      metadata: {
        request_category: REQUEST_CATEGORY,
        email_delivery: emailDelivery,
        request_reopened: Boolean(existingResult.data),
      },
    });
    if (activityError) {
      throw new Error(
        `PIN request ${requestRow.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }
    if (!emailResult.success) {
      return NextResponse.json(
        {
          error: `PIN request was saved, but its notification failed: ${
            emailResult.error ?? "unknown email failure"
          }`,
          code: "PIN_REQUEST_EMAIL_FAILED",
          requestId: requestRow.id,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      request: {
        id: requestRow.id,
        created: !existingResult.data,
      },
      emailDelivery,
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown FMCSA Portal PIN request failure",
        code: "PIN_REQUEST_FAILED",
      },
      { status: 500 }
    );
  }
}
