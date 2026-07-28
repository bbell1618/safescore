import { NextResponse } from "next/server";
import { resolveAuthCallbackNext } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = resolveAuthCallbackNext(
    searchParams.get("next"),
    "/update-password"
  );

  if (!tokenHash || type !== "recovery") {
    return NextResponse.redirect(
      `${origin}/login?auth_error=${encodeURIComponent("The password reset link is invalid or incomplete.")}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  });

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?auth_error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
