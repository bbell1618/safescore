import {
  loadRosterCollection,
  resolveOpenRosterRequest,
  rosterFailureResponse,
} from "@/lib/roster-collection/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { service, request } = await resolveOpenRosterRequest(token);
    return Response.json(await loadRosterCollection(service, request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return rosterFailureResponse(error);
  }
}
