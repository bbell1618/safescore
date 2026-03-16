import { NextResponse } from "next/server";

// Redirect to the parent route handler
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Forward to the [id] POST handler
  const url = new URL(request.url);
  const newUrl = new URL(`/api/cases/dataq/${id}`, url.origin);

  return fetch(newUrl.toString(), {
    method: "POST",
    headers: request.headers,
  });
}
