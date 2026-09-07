import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Resolves the signed-in user for the current request, or returns a 401
 * JSON response to send back immediately. Every user-scoped route handler
 * (lists, memory, baskets, shares) calls this first and returns `response`
 * if present, per this task's "reject unauthenticated requests on
 * user-scoped resources" requirement.
 *
 * Uses supabase.auth.getUser() (not getSession()) because getUser()
 * revalidates the token against Supabase Auth itself rather than trusting
 * whatever's in the cookie -- the correct choice for server-side auth
 * checks per Supabase's own guidance.
 */
export async function requireUser(supabase: SupabaseClient): Promise<
  | { user: { id: string; email?: string }; response: null }
  | { user: null; response: NextResponse }
> {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      user: null,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  return { user: data.user, response: null };
}
