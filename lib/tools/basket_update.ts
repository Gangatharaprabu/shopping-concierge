/**
 * basket_update tool
 *
 * Contract: /docs/tool-specs/basket_update.md (read that first — this file
 * implements it, doesn't redefine it).
 *
 * This is the business-logic layer on top of backend-agent's raw
 * `PATCH /api/baskets/[id]` persistence (/app/api/baskets/[id]/route.ts),
 * which just writes whatever `items` array it's handed. `basketUpdate` is
 * where `check_inventory` actually gets *used* in the basket-building flow:
 *
 *   user views ShoppingList -> marks some items owned -> hits the basket
 *   CTA -> harness calls basketUpdate(basketId, { listItems: list.items })
 *   -> basketUpdate runs checkInventory itself, drops the owned items, and
 *   persists only the needs-sourcing subset as the basket's items.
 *
 * Persistence is injected (deps.getBasket / deps.saveBasketItems), the same
 * DI shape resolve_products.ts uses for its cache/search provider — this
 * file never talks to Supabase or any network directly, so it's testable
 * with plain mocks and has no live-credential requirement. There is
 * deliberately NO default Supabase-backed implementation here: constructing
 * a real request-scoped Supabase client requires Next.js request context
 * (cookies()), which this generic lib function has no business assuming --
 * the caller (a route handler / the harness, which does have that context)
 * is responsible for wiring deps to whatever persistence it actually has.
 *
 * Status lock: `patch.status`, if present and not "draft", is rejected
 * outright (same defense-in-depth pattern as the PATCH route). This tool
 * must never grow order/checkout fields or logic -- per CLAUDE.md's locked
 * decision #1 ("Ordering/checkout is OUT OF SCOPE for this phase. Basket
 * ends in a stubbed 'Buy'/'Get this' CTA with no real handoff.").
 */

import type { BasketItem, BasketRow, ListItem } from "../types";
import { checkInventory } from "./check_inventory";

/** Thrown when a caller tries to move a basket out of "draft" via basketUpdate. */
export class BasketStatusLockedError extends Error {
  constructor() {
    super(
      "basket status cannot be changed -- baskets only support 'draft' in this phase (no checkout yet)",
    );
    this.name = "BasketStatusLockedError";
  }
}

export interface BasketPersistenceDeps {
  /** Fetch the basket's current persisted state. Return null if it doesn't exist. */
  getBasket(basketId: string): Promise<BasketRow | null>;
  /** Persist a full replacement of the basket's items array (status is never touched here). */
  saveBasketItems(basketId: string, items: BasketItem[]): Promise<BasketRow>;
}

export interface BasketUpdateDeps {
  persistence: BasketPersistenceDeps;
}

export interface BasketUpdatePatch {
  /**
   * A `ShoppingList`'s `items[]` (or any `ListItem[]` subset of one), as-is
   * -- including items the user has marked `owned`. This is the primary
   * input for the "mark owned -> hit basket CTA" flow: pass the list's
   * *current* items and basketUpdate runs check_inventory itself. Callers
   * should NOT pre-filter owned items out before calling this -- that
   * filtering is this tool's job, not the caller's.
   */
  listItems?: ListItem[];
  /**
   * Basket items to add/set directly, already in `BasketItem` shape -- e.g.
   * items a caller already resolved via `resolve_products` and mapped
   * itself. These are added as-is and are NOT re-filtered by `owned`
   * status (there is no `owned` field on `BasketItem`/`ProductCandidate`)
   * -- callers are responsible for only passing already-needs-sourcing
   * items here.
   */
  items?: BasketItem[];
  /**
   * "replace" (default): the basket's items become exactly
   * `listItems`-minus-owned plus `items`, recomputed fresh from what was
   * passed in. Correct for the common case -- the user re-marks something
   * owned and re-hits the CTA, and stale entries from a previous state of
   * the list shouldn't linger in the basket.
   * "append": merge the new items onto the basket's *existing* persisted
   * items instead of replacing -- for incrementally adding more items to
   * an already-built basket. Merging is keyed by `source_item_id` when
   * present (falling back to a case-insensitive `name` match for
   * manually-added items with no `source_item_id`), so re-adding the same
   * item updates its quantity in place rather than duplicating the line.
   */
  mode?: "replace" | "append";
  /**
   * Present only so this tool can defensively reject any attempt to change
   * it, mirroring the PATCH route -- baskets never support anything but
   * "draft" in this phase. Never read for any other purpose.
   */
  status?: unknown;
}

export interface BasketUpdateResult {
  basket: BasketRow;
  /** The subset of `patch.listItems` that was actually added to the basket (owned items excluded). */
  addedFromList: ListItem[];
  /** The subset of `patch.listItems` that was excluded because the user already owns it. */
  skippedOwned: ListItem[];
}

function basketItemKey(item: BasketItem): string {
  return item.source_item_id != null ? `id:${item.source_item_id}` : `name:${item.name.trim().toLowerCase()}`;
}

function listItemToBasketItem(item: ListItem): BasketItem {
  return {
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    category: item.category,
    source_item_id: item.source_item_id ?? null,
  };
}

/** Merges `incoming` onto `existing`, replacing any item that shares a key (see basketItemKey) rather than duplicating it. */
function mergeBasketItems(existing: BasketItem[], incoming: BasketItem[]): BasketItem[] {
  const merged = new Map<string, BasketItem>();
  for (const item of existing) merged.set(basketItemKey(item), item);
  for (const item of incoming) merged.set(basketItemKey(item), item);
  return [...merged.values()];
}

/**
 * Applies `patch` to the basket identified by `basketId`.
 *
 * `deps` is required in practice (there is no live default -- see file
 * header) but kept as an optional parameter so the signature matches the
 * shape a caller building on this tool expects; omitting it throws
 * immediately with a clear message rather than silently no-op'ing or
 * reaching for a network call this function shouldn't own.
 */
export async function basketUpdate(
  basketId: string,
  patch: BasketUpdatePatch,
  deps?: BasketUpdateDeps,
): Promise<BasketUpdateResult> {
  if (patch.status !== undefined && patch.status !== "draft") {
    throw new BasketStatusLockedError();
  }
  if (patch.listItems === undefined && patch.items === undefined) {
    throw new Error("basketUpdate requires at least one of patch.listItems or patch.items");
  }
  if (!deps) {
    throw new Error(
      "basketUpdate requires deps.persistence (getBasket/saveBasketItems) -- no default " +
        "Supabase-backed implementation is wired at this layer; the caller (route handler/" +
        "harness) must inject one bound to its own request-scoped Supabase client.",
    );
  }

  const { needsSourcing, alreadyOwned } = checkInventory(patch.listItems ?? []);
  const newItems = [...needsSourcing.map(listItemToBasketItem), ...(patch.items ?? [])];

  const mode = patch.mode ?? "replace";

  let finalItems: BasketItem[];
  if (mode === "append") {
    const existing = await deps.persistence.getBasket(basketId);
    if (!existing) {
      throw new Error(`basket not found: ${basketId}`);
    }
    finalItems = mergeBasketItems(existing.items, newItems);
  } else {
    finalItems = newItems;
  }

  const basket = await deps.persistence.saveBasketItems(basketId, finalItems);

  return { basket, addedFromList: needsSourcing, skippedOwned: alreadyOwned };
}
