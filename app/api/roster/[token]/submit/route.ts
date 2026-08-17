import {
  resolveOpenRosterRequest,
  rosterFailureResponse,
  RosterRouteFailure,
} from "@/lib/roster-collection/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const resolved = await resolveOpenRosterRequest(token);
    const { count, error: countError } = await resolved.service
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("client_id", resolved.request.clientId)
      .eq("request_id", resolved.request.id)
      .eq("source", "client_portal");
    if (countError) {
      throw new RosterRouteFailure(
        `Unable to count the saved drivers: ${countError.message}`,
        500,
        "ROSTER_DRIVER_COUNT_FAILED"
      );
    }
    const driverCount = count ?? 0;
    if (driverCount < 1) {
      throw new RosterRouteFailure(
        "Add at least one driver before submitting the list.",
        409,
        "ROSTER_EMPTY"
      );
    }
    const submittedAt = new Date().toISOString();
    const response = `${driverCount} driver${driverCount === 1 ? "" : "s"} submitted`;
    const { data: updated, error: updateError } = await resolved.service
      .from("client_requests")
      .update({
        submitted_at: submittedAt,
        response,
        status_copy:
          "Driver list received — your Golden Era SafeScore team will review it.",
        next_reminder_at: null,
        updated_at: submittedAt,
      })
      .eq("id", resolved.request.id)
      .eq("client_id", resolved.request.clientId)
      .eq("request_type", "roster_collection")
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      throw new RosterRouteFailure(
        `Unable to submit the driver list: ${
          updateError?.message ?? "request is no longer open"
        }`,
        updateError ? 500 : 409,
        "ROSTER_SUBMIT_FAILED"
      );
    }
    const { error: activityError } = await resolved.service
      .from("activity_log")
      .insert({
        client_id: resolved.request.clientId,
        action_type: "client_driver_roster_submitted",
        entity_type: "client_requests",
        entity_id: resolved.request.id,
        description: response,
        metadata: {
          request_type: "roster_collection",
          driver_count: driverCount,
          source: "client_portal",
        },
      });
    if (activityError) {
      throw new RosterRouteFailure(
        `The driver list was submitted, but activity logging failed: ${activityError.message}`,
        500,
        "ROSTER_SUBMIT_ACTIVITY_FAILED"
      );
    }
    return Response.json({ ok: true, submittedAt, response, driverCount });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}
