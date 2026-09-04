import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

/**
 * Service-role Supabase client. Bypasses RLS entirely -- do not use this
 * from a user-facing API route. It exists for offline/trusted server-side
 * code that legitimately needs to write shared data outside any single
 * user's ownership, e.g. the use_cases seed loader
 * (/scripts/load-seed-usecases.ts).
 */
export function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
