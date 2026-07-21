import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const { data: userRecord } = user
    ? await supabase.from("users").select("role, client_id").eq("id", user.id).maybeSingle()
    : { data: null };
  const role = userRecord?.role as string | undefined;
  const isStaff = role === "geia_admin" || role === "geia_staff";
  const isClient = role === "client_user";

  if (path.startsWith("/api/")) {
    const publicApiExactPaths = new Set([
      "/api/cron/monitoring-refresh",
    ]);
    const publicApiPrefixes = [
      "/api/auth/setup",
      "/api/billing/webhook",
      "/api/fmcsa/",
    ];
    const isPublicEvidenceUpload = /^\/api\/evidence\/[^/]+\/upload$/.test(path);
    if (
      isPublicEvidenceUpload ||
      publicApiExactPaths.has(path) ||
      publicApiPrefixes.some((prefix) => path.startsWith(prefix))
    ) return supabaseResponse;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const staffOnlyPrefixes = [
      "/api/analysis/",
      "/api/cases/",
      "/api/clients",
      "/api/requests/",
      "/api/violations/",
      "/api/reports/generate-text",
    ];
    const staffOnlyExact = path === "/api/reports" || /^\/api\/reports\/[^/]+\/send$/.test(path);
    if ((staffOnlyExact || staffOnlyPrefixes.some((prefix) => path.startsWith(prefix))) && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const clientOnlyPrefixes = [
      "/api/portal/",
      "/api/billing/create-checkout-session",
      "/api/billing/portal",
      "/api/billing/sync",
    ];
    if (clientOnlyPrefixes.some((prefix) => path.startsWith(prefix)) && !isClient) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return supabaseResponse;
  }

  if (!user && !path.startsWith("/login") && !path.startsWith("/auth") && !path.startsWith("/setup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = isClient ? "/portal" : "/console";
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/console") && !isStaff) {
    const url = request.nextUrl.clone();
    url.pathname = isClient ? "/portal" : "/login";
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/portal")) {
    if (!isClient) {
      const url = request.nextUrl.clone();
      url.pathname = isStaff ? "/console" : "/login";
      return NextResponse.redirect(url);
    }
    const isOnboardingPath = path === "/portal/onboarding" || path.startsWith("/portal/onboarding/");
    if (!isOnboardingPath && userRecord?.client_id) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("client_id", userRecord.client_id)
        .eq("status", "active")
        .maybeSingle();
      if (!subscription) {
        const url = request.nextUrl.clone();
        url.pathname = "/portal/onboarding";
        return NextResponse.redirect(url);
      }
    }
  }

  if ((path === "/onboarding" || path.startsWith("/onboarding/")) && user && !isClient) {
    const url = request.nextUrl.clone();
    url.pathname = isStaff ? "/console" : "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
