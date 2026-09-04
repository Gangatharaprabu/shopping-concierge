/**
 * Env var contract for every Supabase client in this app, all in one place
 * so misconfiguration fails loudly and immediately (same "fail fast, never
 * silently no-op" pattern as scripts/usecase-pipeline/generate-batch.ts's
 * ANTHROPIC_API_KEY handling) rather than surfacing as a confusing runtime
 * error deep inside a route handler.
 *
 * - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: safe to expose
 *   to the browser (standard Supabase + Next.js convention), used for the
 *   RLS-respecting client that every route handler uses on behalf of the
 *   signed-in user.
 * - SUPABASE_SERVICE_ROLE_KEY: server-only secret, NEVER prefixed
 *   NEXT_PUBLIC_. Bypasses RLS entirely -- used only where that's
 *   genuinely required (the seed loader in /scripts/load-seed-usecases.ts).
 *   No API route in this app currently needs it; user-scoped routes should
 *   always go through the anon-key/session-respecting client so RLS stays
 *   the actual enforcement mechanism, not something routes have to
 *   reimplement in application code.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. This app talks to a real Supabase project and will not ` +
        `silently no-op -- set ${name} in your environment (e.g. .env.local) before ` +
        `starting the app or running this script.`
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}
