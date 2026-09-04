import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Per-request Supabase client for use in Next.js App Router route handlers
 * (and server components), bound to the caller's own auth session via
 * cookies. Every query made through this client is subject to the RLS
 * policies in /db/migrations -- this is the ONLY client user-scoped API
 * routes should use (never the service-role/admin client), so RLS stays the
 * real enforcement boundary rather than something each route re-implements.
 *
 * Must be awaited and called fresh per request (cookies() is request-scoped
 * in the App Router) -- don't hoist/cache the returned client across
 * requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Route handlers CAN set cookies (needed to persist a refreshed
          // auth session), but some server-component call sites can't --
          // safe to ignore there since middleware/route handlers are the
          // paths that actually need the refreshed session persisted.
        }
      },
    },
  });
}
