import { NextResponse } from "next/server";
import { OnboardingRouteFailure, requireStaffOnboardingUser } from "@/lib/onboarding/server";
import { fetchPublicBasicMeasures } from "@/lib/fmcsa/public-basic-measures";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dot: string }> }) {
  try {
    await requireStaffOnboardingUser();
    const { dot } = await params;
    if (!/^[1-9]\d{0,8}$/.test(dot)) return NextResponse.json({ error: "Invalid USDOT number" }, { status: 400 });
    return NextResponse.json(await fetchPublicBasicMeasures(dot), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown public SMS source failure" },
      { status: error instanceof OnboardingRouteFailure ? error.status : 502, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
