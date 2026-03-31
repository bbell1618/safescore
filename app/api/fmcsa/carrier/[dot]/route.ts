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
    console.error(`FMCSA carrier fetch failed for DOT ${dot}:`, message);
    return NextResponse.json({ error: message, carrier: null }, { status: 500 });
  }
}
