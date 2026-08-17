import {
  loadScopedStagedDriver,
  resolveOpenRosterRequest,
  rosterFailureResponse,
  RosterRouteFailure,
  saveRosterDocument,
  validateRosterUpload,
} from "@/lib/roster-collection/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ token: string; driverId: string }> }
) {
  try {
    const { token, driverId } = await params;
    const resolved = await resolveOpenRosterRequest(token);
    const driver = await loadScopedStagedDriver(
      resolved.service,
      resolved.request,
      driverId
    );
    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      throw new RosterRouteFailure(
        `Unable to read the selected file: ${
          error instanceof Error ? error.message : String(error)
        }`,
        400,
        "ROSTER_DOCUMENT_FORM_INVALID"
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new RosterRouteFailure(
        "Choose a file before uploading.",
        400,
        "ROSTER_DOCUMENT_REQUIRED"
      );
    }
    const docType = validateRosterUpload(file, form.get("docType"));
    const document = await saveRosterDocument({
      service: resolved.service,
      request: resolved.request,
      driver,
      docType,
      file,
    });
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}
