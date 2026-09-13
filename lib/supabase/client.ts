import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Browser-side Supabase client, bound to the same NEXT_PUBLIC_* env vars as
 * the server client (lib/supabase/server.ts) -- both talk to the same
 * project, `@supabase/ssr` just wires cookie handling differently depending
 * on which side of the request boundary you're on.
 *
 * Only used by client components that need to call Supabase Auth directly
 * (currently: the magic-link sign-in form at /app/login/page.tsx). Everything
 * else in this app talks to our own /app/api/* route handlers, which use the
 * server client under the hood -- there is no reason for a client component
 * to query `use_cases`/`shopping_lists`/etc. directly.
 *
 * Construct a fresh client per call site (cheap; no request-scoped state to
 * share client-side) rather than a module-level singleton, mirroring the
 * server client's "call fresh per request" convention.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
