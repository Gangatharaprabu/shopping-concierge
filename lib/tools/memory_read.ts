/**
 * memory_read tool
 *
 * Reads and returns the caller's durable UserMemory record (household_size,
 * dietary_prefs, budget_tier, brand_prefs) -- the global, cross-session
 * preferences described in CLAUDE.md's "Canonical data models" and
 * protected by locked decision #3 (the memory boundary).
 *
 * Contract: /docs/tool-specs/memory_read.md (read that first -- this file
 * implements it, doesn't redefine it).
 *
 * This is a straightforward read-through wrapper around persistence -- all
 * the boundary-relevant design decisions live in memory_write.ts, since
 * reading durable memory back out can't itself violate the boundary (only
 * *writing* session-only data into it can).
 */

import { SupabaseMemoryStore, type MemoryStore, type UserMemory } from "./memory/store";

export type { MemoryStore, UserMemory } from "./memory/store";

// Module-level default so repeated calls within the same process share
// nothing stateful (there's no cache here, unlike resolve_products) but
// still avoid re-constructing a store per call -- mirrors resolve_products.ts's
// defaultCache/defaultSearchProvider pattern. See SupabaseMemoryStore's doc
// comment for why this default only works inside an actual Next.js request.
const defaultStore = new SupabaseMemoryStore();

export interface MemoryReadDeps {
  store?: MemoryStore;
}

/** All-empty shape for a user who has never written any durable preference -- not an error state. */
function emptyMemory(userId: string): UserMemory {
  return {
    user_id: userId,
    household_size: null,
    dietary_prefs: [],
    budget_tier: null,
    brand_prefs: [],
    updated_at: null,
  };
}

export async function memoryRead(userId: string, deps: MemoryReadDeps = {}): Promise<UserMemory> {
  const store = deps.store ?? defaultStore;
  const row = await store.getUserMemory(userId);
  return row ?? emptyMemory(userId);
}
