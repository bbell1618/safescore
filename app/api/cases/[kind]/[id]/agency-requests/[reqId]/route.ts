import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireStaffOnboardingUser, OnboardingRouteFailure } from "@/lib/onboarding/server";
import { AgencyRequestError, markLapsed, markResponded, parseAgencyCaseKind, requireAgencyRequestScope } from "@/lib/cases/agency-requests";

export async function PATCH(request: Request, { params }: { params: Promise<{ kind: string; id: string; reqId: string }> }) {
  try {
    await requireStaffOnboardingUser();
    const { kind, id, reqId } = await params;
    const caseKind = parseAgencyCaseKind(kind);
    await requireAgencyRequestScope(reqId, caseKind, id);
    const body = await request.json();
    if (body.action !== "responded" && body.action !== "lapsed") throw new AgencyRequestError("Unknown action");
    const row = body.action === "responded"
      ? await markResponded(reqId, body.date, body.notes)
      : await markLapsed(reqId, body.notes);
    return NextResponse.json({ request: row });
  } catch (error) {
    const status = error instanceof AgencyRequestError ? error.status
      : error instanceof OnboardingRouteFailure ? (error.status === 401 ? 403 : error.status)
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
