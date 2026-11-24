import { createServerClient } from "@/lib/supabase/schema-client";
import { createClient as createSupabaseClient } from "@/lib/supabase/schema-client";
import { cookies, headers } from "next/headers";
import { bridgeToken } from "./bridge";

export async function createClient() {
  // QF-230: a call from GoldenDesk carries the person's own session token instead of cookies.
  const token = bridgeToken(await headers());
  if (token) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const getUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = (jwt?: string) => getUser(jwt ?? token);
    return client as ReturnType<typeof createServerClient>;
  }
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — cookie setting handled in middleware
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
