import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireStaffOnboardingUser, OnboardingRouteFailure } from "@/lib/onboarding/server";
import { AgencyRequestError, createAgencyRequest, parseAgencyCaseKind, requireAgencyCase } from "@/lib/cases/agency-requests";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { userId } = await requireStaffOnboardingUser();
    const { kind, id } = await params;
    const caseKind = parseAgencyCaseKind(kind);
    const caseRow = await requireAgencyCase(caseKind, id);
    const body = await request.json();
    const row = await createAgencyRequest({ ...body, client_id: caseRow.client_id, case_kind: caseKind, case_id: id, created_by: userId });
    return NextResponse.json({ request: row }, { status: 201 });
  } catch (error) {
    const status = error instanceof AgencyRequestError ? error.status
      : error instanceof OnboardingRouteFailure ? (error.status === 401 ? 403 : error.status)
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
