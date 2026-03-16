import { getCarrier } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dot: string }> }
) {
  const { dot } = await params;
  try {
    const carrier = await getCarrier(dot);
    return NextResponse.json({ carrier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
