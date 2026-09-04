import type { ResolveProductsOutput } from "./types";

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h per spec

/**
 * Normalizes an item_name into the string used as the cache key: lowercase,
 * trimmed, internal whitespace collapsed. Per spec, cache key is scoped to
 * item_name only (not quantity/user_budget_tier) — see the note in
 * resolve_products.ts for why.
 */
export function normalizeItemName(itemName: string): string {
  return itemName.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cache abstraction for resolve_products results, keyed by normalized
 * item_name, with a 24h TTL enforced by the implementation.
 *
 * This is intentionally storage-agnostic: backend-agent is building the
 * Supabase/Postgres persistence layer in parallel on a different branch.
 * Once that lands, add a Postgres-backed implementation of this interface
 * (e.g. a `product_cache(key text primary key, value jsonb, expires_at
 * timestamptz)` table) and swap it in — nothing in resolve_products.ts
 * needs to change, it only depends on this interface.
 */
export interface ProductCache {
  get(key: string): Promise<ResolveProductsOutput | undefined>;
  set(key: string, value: ResolveProductsOutput): Promise<void>;
}

interface CacheEntry {
  value: ResolveProductsOutput;
  expiresAt: number;
}

/**
 * Simple process-memory cache. Fine for this prototype (~100 users, single
 * deployable app per CLAUDE.md conventions) — resets on redeploy, and isn't
 * shared across multiple instances, both acceptable until the DB-backed
 * implementation lands.
 */
export class InMemoryProductCache implements ProductCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS) {}

  async get(key: string): Promise<ResolveProductsOutput | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: ResolveProductsOutput): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
