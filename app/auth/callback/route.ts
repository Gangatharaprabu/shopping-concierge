import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback?code=...&next=...
 *
 * Supabase Auth's PKCE magic-link redirect target: exchanges the one-time
 * `code` for a session (setting the auth cookies via the server client),
 * then redirects on to wherever the sign-in was started from (`next`,
 * defaulting to the feed). Standard Supabase-SSR pattern -- see
 * https://supabase.com/docs/guides/auth/server-side/nextjs for the
 * reference implementation this mirrors.
 *
 * Not reachable end-to-end in this sandbox (no live Supabase project to
 * actually issue a magic link/code), but the route is wired the same way it
 * would need to be against a real project.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
