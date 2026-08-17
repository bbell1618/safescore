import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

const idsSchema = z.object({ clientId: z.string().uuid(), requestId: z.string().uuid() });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const values = await params;
    const ids = idsSchema.safeParse({
      clientId: values.id,
      requestId: values.requestId,
    });
    if (!ids.success) {
      return Response.json(
        { error: "Valid client and request IDs are required.", code: "INVALID_IDS" },
        { status: 400 }
      );
    }
    const { service, userId } = await requireStaffOnboardingUser();
    const { data: requestRow, error: requestError } = await service
      .from("client_requests")
      .select("id, status, request_type, submitted_at")
      .eq("id", ids.data.requestId)
      .eq("client_id", ids.data.clientId)
      .maybeSingle();
    if (requestError) {
      throw new Error(
        `Unable to load the driver-list request: ${requestError.message}`
      );
    }
    if (!requestRow || requestRow.request_type !== "roster_collection") {
      return Response.json(
        { error: "Driver-list request not found.", code: "ROSTER_REQUEST_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (requestRow.status !== "open") {
      return Response.json(
        { error: "The driver-list request is already closed.", code: "ROSTER_REQUEST_CLOSED" },
        { status: 409 }
      );
    }
    if (!requestRow.submitted_at) {
      return Response.json(
        { error: "The client has not submitted this driver list yet.", code: "ROSTER_NOT_SUBMITTED" },
        { status: 409 }
      );
    }
    const { count, error: pendingError } = await service
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ids.data.clientId)
      .eq("request_id", ids.data.requestId)
      .eq("source", "client_portal")
      .is("approved_at", null);
    if (pendingError) {
      throw new Error(
        `Unable to count pending client-submitted drivers: ${pendingError.message}`
      );
    }
    if ((count ?? 0) > 0) {
      return Response.json(
        {
          error: `${count} client-submitted driver${count === 1 ? " still needs" : "s still need"} review before this request can close.`,
          code: "ROSTER_REVIEW_PENDING",
          pendingDrivers: count,
        },
        { status: 409 }
      );
    }

    const closedAt = new Date().toISOString();
    const { data: closed, error: closeError } = await service
      .from("client_requests")
      .update({
        status: "fulfilled",
        status_copy: "Driver list reviewed and added to your safety program.",
        closed_at: closedAt,
        next_reminder_at: null,
        updated_at: closedAt,
      })
      .eq("id", ids.data.requestId)
      .eq("client_id", ids.data.clientId)
      .eq("request_type", "roster_collection")
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (closeError || !closed) {
      throw new Error(
        `Unable to close the driver-list request: ${
          closeError?.message ?? "request changed concurrently"
        }`
      );
    }
    const { error: activityError } = await service.from("activity_log").insert({
      client_id: ids.data.clientId,
      user_id: userId,
      action_type: "client_driver_roster_request_closed",
      entity_type: "client_requests",
      entity_id: ids.data.requestId,
      description: "Client driver-list request reviewed and closed",
      metadata: { request_type: "roster_collection" },
    });
    if (activityError) {
      throw new Error(
        `The driver-list request was closed, but activity logging failed: ${activityError.message}`
      );
    }
    return Response.json({
      request: { id: ids.data.requestId, status: "fulfilled", closedAt },
    });
  } catch (error) {
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
            : "Unknown driver-list close failure",
        code: "ROSTER_REQUEST_CLOSE_FAILED",
      },
      { status: 500 }
    );
  }
}
