import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * Runs on every page/API request. If the caller has no Supabase session yet,
 * transparently establishes an anonymous one (Supabase Auth's built-in
 * `signInAnonymously` -- a real session/`auth.uid()`, no email, no visible
 * login screen) so every RLS-scoped table (shopping_lists, baskets,
 * user_memory, list_shares) keeps working exactly as designed without ever
 * routing a visitor through /login.
 *
 * Requires "Allow anonymous sign-ins" enabled in the Supabase project's
 * Authentication settings -- if it's off, signInAnonymously() fails silently
 * here (caught, not thrown) and requests fall back to whatever unauthenticated
 * behavior each route/page already has (public browse still works; anything
 * user-scoped surfaces its own "couldn't reach/create" error rather than a
 * login wall, since that wall has been removed).
 *
 * File named `proxy.ts` (not `middleware.ts`) per this Next.js version's
 * convention -- see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md, "Migration to Proxy": `middleware` is
 * deprecated and renamed to `proxy` as of v16.0.0.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      await supabase.auth.signInAnonymously();
    }
  } catch {
    // No live Supabase project reachable, or anonymous sign-ins disabled --
    // let the request through as unauthenticated rather than blocking it.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
