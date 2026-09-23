import { NextResponse } from "next/server";
import { requirePortalOnboardingClient, OnboardingRouteFailure } from "@/lib/onboarding/server";
import { assessmentPriceId, assessmentCovered, getAssessmentBilling } from "@/lib/billing/assessment";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { service, clientId } = await requirePortalOnboardingClient();
    const billing = await getAssessmentBilling(service, clientId);
    return NextResponse.json({ available: Boolean(assessmentPriceId()), covered: assessmentCovered(billing), geiaInsured: billing?.geia_insured === true, paid: Boolean(billing?.paid_at) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof OnboardingRouteFailure ? error.status : 500 });
  }
}
