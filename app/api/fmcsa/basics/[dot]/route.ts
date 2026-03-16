import { getBasics } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dot: string }> }
) {
  const { dot } = await params;
  try {
    const basics = await getBasics(dot);
    return NextResponse.json({ basics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
