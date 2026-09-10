/**
 * Shared persistence layer for the memory_read / memory_write tools.
 *
 * Mirrors the dependency-injection pattern used by resolve_products.ts
 * (cache.ts / search-provider.ts): a small interface (`MemoryStore`) the
 * tool functions depend on, plus one real implementation
 * (`SupabaseMemoryStore`) that talks to the actual `user_memory` table (see
 * /db/migrations/0005_user_memory.sql), so tests can inject a fake store
 * instead of touching Supabase.
 *
 * This file is *raw persistence only* -- same division of responsibility as
 * /app/api/memory/route.ts already documents: this module reads/writes
 * whatever durable-shaped patch it's given for a user_id, full stop. The
 * memory-boundary enforcement (what's even allowed to reach this module) is
 * memory_write.ts's job, one layer up -- see the design note there.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BudgetTier, UserMemoryRow } from "@/lib/types";

/**
 * The four durable UserMemory fields (CLAUDE.md: "household size, dietary
 * prefs, budget tier, brand prefs") and nothing else. All optional because
 * both the store and memory_write treat writes as *patches*: an unspecified
 * key leaves that field unchanged, matching PUT /api/memory's semantics.
 *
 * Deliberately does NOT include `user_id` (that's a separate function
 * argument, not part of the patch shape) or anything session/event-scoped
 * (time_of_day, headcount, setting, duration, ad hoc Scenario slot ids) --
 * there is no field on this type a caller could use to smuggle those
 * through, by construction.
 */
export interface DurableMemoryFields {
  household_size?: number | null;
  dietary_prefs?: string[];
  budget_tier?: BudgetTier | null;
  brand_prefs?: string[];
}

/**
 * Public read shape returned by memory_read/memory_write. Identical to
 * UserMemoryRow (lib/types.ts) except `updated_at` is nullable, to honestly
 * represent the "user has no memory row yet" case -- GET /api/memory
 * returns the same all-empty-with-null-updated_at default for a user who's
 * never written any durable preference (see route.ts's GET handler).
 */
export interface UserMemory extends Omit<UserMemoryRow, "updated_at"> {
  updated_at: string | null;
}

export interface MemoryStore {
  /** Returns null if the user has no user_memory row yet (not an error). */
  getUserMemory(userId: string): Promise<UserMemoryRow | null>;
  /** Upserts only the keys present in `patch`; a key absent from `patch` is left unchanged. */
  upsertUserMemory(userId: string, patch: DurableMemoryFields): Promise<UserMemoryRow>;
}

/**
 * Real MemoryStore backed by Postgres via Supabase.
 *
 * Uses the RLS-respecting, request-scoped client (createSupabaseServerClient,
 * same as every other user-scoped route in this app -- see
 * lib/supabase/server.ts's doc comment) by default, obtained fresh on every
 * call since it's bound to the current request's cookies. That client can
 * only be constructed inside an actual Next.js request (it calls
 * `cookies()`); calling a SupabaseMemoryStore with no injected client
 * outside of a request will throw, which is intentional fail-fast behavior
 * (same philosophy as lib/supabase/env.ts's requireEnv) rather than a
 * silent no-op -- tests and any non-request caller should inject a
 * SupabaseClient (or a fake MemoryStore) explicitly instead of relying on
 * this default.
 *
 * RLS also means passing a `userId` that isn't the signed-in cookie user is
 * harmless-but-useless with this default client: the `user_memory_owner_*`
 * policies (0005_user_memory.sql) silently scope every query to
 * auth.uid() = user_id, so a mismatched userId just returns no rows /
 * upserts nothing rather than reading/writing someone else's memory. If a
 * future caller needs to act as a specific user_id server-to-server
 * (outside any request, e.g. a batch job), it should inject the admin
 * client explicitly and accept that RLS is no longer the safety net --
 * not something this default silently supports.
 */
export class SupabaseMemoryStore implements MemoryStore {
  constructor(private readonly client?: SupabaseClient) {}

  private async getClient(): Promise<SupabaseClient> {
    return this.client ?? ((await createSupabaseServerClient()) as unknown as SupabaseClient);
  }

  async getUserMemory(userId: string): Promise<UserMemoryRow | null> {
    const supabase = await this.getClient();
    const { data, error } = await supabase.from("user_memory").select().eq("user_id", userId).maybeSingle();
    if (error) {
      throw new Error(`memory store: failed to read user_memory for ${userId}: ${error.message}`);
    }
    return (data as UserMemoryRow | null) ?? null;
  }

  async upsertUserMemory(userId: string, patch: DurableMemoryFields): Promise<UserMemoryRow> {
    const supabase = await this.getClient();

    const row: Record<string, unknown> = { user_id: userId };
    if (patch.household_size !== undefined) row.household_size = patch.household_size;
    if (patch.dietary_prefs !== undefined) row.dietary_prefs = patch.dietary_prefs;
    if (patch.budget_tier !== undefined) row.budget_tier = patch.budget_tier;
    if (patch.brand_prefs !== undefined) row.brand_prefs = patch.brand_prefs;

    const { data, error } = await supabase
      .from("user_memory")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      throw new Error(`memory store: failed to write user_memory for ${userId}: ${error.message}`);
    }
    return data as UserMemoryRow;
  }
}
