import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // API routes handle their own auth — let them through
  if (path.startsWith("/api/")) {
    return supabaseResponse;
  }

  // Not logged in — redirect to login (unless already on auth pages)
  if (!user && !path.startsWith("/login") && !path.startsWith("/auth") && !path.startsWith("/portal/setup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Logged in on login page — redirect to console (staff) or portal (client)
  if (user && path.startsWith("/login")) {
    // Determine role from user metadata
    const role = user.user_metadata?.role as string | undefined;
    const url = request.nextUrl.clone();
    url.pathname = role === "client_user" ? "/portal" : "/console";
    return NextResponse.redirect(url);
  }

  // Protect /console/* — must be geia_admin or geia_staff
  if (path.startsWith("/console")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    const role = user.user_metadata?.role as string | undefined;
    if (role === "client_user") {
      const url = request.nextUrl.clone();
      url.pathname = "/portal";
      return NextResponse.redirect(url);
    }
  }

  // Protect /portal/* — must be client_user
  if (path.startsWith("/portal") && !path.startsWith("/portal/setup")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // Subscription gate — skip for onboarding pages themselves
    const isOnboardingPath =
      path === "/portal/onboarding" ||
      path.startsWith("/portal/onboarding/");

    if (!isOnboardingPath) {
      const role = user.user_metadata?.role as string | undefined;

      // Only enforce subscription check for client_users
      if (role === "client_user") {
        // Look up client_id for this user
        const { data: userRecord } = await supabase
          .from("users")
          .select("client_id")
          .eq("id", user.id)
          .single();

        if (userRecord?.client_id) {
          // Check for an active subscription
          const { data: subscription } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("client_id", (userRecord as any).client_id)
            .eq("status", "active")
            .maybeSingle();

          if (!subscription) {
            const url = request.nextUrl.clone();
            url.pathname = "/portal/onboarding";
            return NextResponse.redirect(url);
          }
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
