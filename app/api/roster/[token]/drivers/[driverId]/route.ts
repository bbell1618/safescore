import {
  deleteStagedDriverWithDocuments,
  loadScopedStagedDriver,
  resolveOpenRosterRequest,
  rosterDriverUpdateSchema,
  rosterFailureResponse,
  shapeStagedDriver,
  RosterRouteFailure,
} from "@/lib/roster-collection/server";

type RouteContext = {
  params: Promise<{ token: string; driverId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { token, driverId } = await params;
    const resolved = await resolveOpenRosterRequest(token);
    await loadScopedStagedDriver(
      resolved.service,
      resolved.request,
      driverId
    );
    const parsed = rosterDriverUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "Check the driver details and try again.",
          code: "ROSTER_DRIVER_INVALID",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }
    const { data: driver, error } = await resolved.service
      .from("drivers")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", driverId)
      .eq("client_id", resolved.request.clientId)
      .eq("request_id", resolved.request.id)
      .eq("source", "client_portal")
      .is("approved_at", null)
      .select(
        "id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, approved_at, created_at, updated_at"
      )
      .maybeSingle();
    if (error || !driver) {
      throw new RosterRouteFailure(
        `Unable to update the driver: ${
          error?.message ?? "driver is no longer editable"
        }`,
        error ? 500 : 409,
        "ROSTER_DRIVER_UPDATE_FAILED"
      );
    }
    return Response.json({ driver: shapeStagedDriver(driver) });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { token, driverId } = await params;
    const resolved = await resolveOpenRosterRequest(token);
    const driver = await loadScopedStagedDriver(
      resolved.service,
      resolved.request,
      driverId
    );
    await deleteStagedDriverWithDocuments({
      service: resolved.service,
      request: resolved.request,
      driver,
    });
    return Response.json({ ok: true, driverId });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}
