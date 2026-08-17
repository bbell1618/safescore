import {
  resolveOpenRosterRequest,
  rosterDriverCreateSchema,
  rosterFailureResponse,
  shapeStagedDriver,
  RosterRouteFailure,
} from "@/lib/roster-collection/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const resolved = await resolveOpenRosterRequest(token);
    const parsed = rosterDriverCreateSchema.safeParse(await request.json());
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

    // Keep one leaked bearer link from creating an unbounded number of rows.
    const { count, error: countError } = await resolved.service
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("client_id", resolved.request.clientId)
      .eq("request_id", resolved.request.id)
      .eq("source", "client_portal")
      .is("approved_at", null);
    if (countError) {
      throw new RosterRouteFailure(
        `Unable to check the saved driver count: ${countError.message}`,
        500,
        "ROSTER_DRIVER_COUNT_FAILED"
      );
    }
    if ((count ?? 0) >= 500) {
      throw new RosterRouteFailure(
        "This driver list has reached its 500-driver limit. Contact your Golden Era SafeScore team for help.",
        409,
        "ROSTER_DRIVER_LIMIT_REACHED"
      );
    }

    const now = new Date().toISOString();
    const { data: driver, error } = await resolved.service
      .from("drivers")
      .insert({
        client_id: resolved.request.clientId,
        full_name: parsed.data.full_name,
        cdl_number: parsed.data.cdl_number,
        cdl_state: parsed.data.cdl_state,
        cdl_class: parsed.data.cdl_class,
        cdl_expiry: parsed.data.cdl_expiry ?? null,
        medical_cert_expiry: parsed.data.medical_cert_expiry ?? null,
        hired_date: parsed.data.hired_date ?? null,
        status: "active",
        source: "client_portal",
        approved_at: null,
        approved_by: null,
        request_id: resolved.request.id,
        notes: null,
        updated_at: now,
      })
      .select(
        "id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, approved_at, created_at, updated_at"
      )
      .maybeSingle();
    if (error || !driver) {
      throw new RosterRouteFailure(
        `Unable to save the driver: ${error?.message ?? "row not returned"}`,
        500,
        "ROSTER_DRIVER_CREATE_FAILED"
      );
    }
    return Response.json({ driver: shapeStagedDriver(driver) }, { status: 201 });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}
