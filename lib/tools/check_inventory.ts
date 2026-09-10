/**
 * check_inventory tool
 *
 * Contract: /docs/tool-specs/check_inventory.md (read that first — this file
 * implements it, doesn't redefine it).
 *
 * There is no separate persistent "Inventory" entity in this app's data
 * model (see CLAUDE.md's canonical data models) — "what the user already
 * has" is expressed entirely via `ListItem.owned` on a `ShoppingList`. So
 * "inventory subtraction" concretely means: partition a list of `ListItem`s
 * into the subset that still needs to be shopped for vs. the subset the
 * user already owns.
 *
 * Pure function, no I/O — takes items in, returns a partition, nothing else.
 */

import type { ListItem } from "../types";

export interface InventoryPartition {
  /**
   * Items still needing to be sourced (`owned !== true`), in the same
   * relative order they appeared in the input. This is the subset a caller
   * building a basket (see basket_update.ts) should actually act on — feed
   * these into resolve_products / add them to a basket, not the raw
   * unfiltered list.
   */
  needsSourcing: ListItem[];
  /**
   * Items the user has already marked as owned (`owned === true`), in the
   * same relative order they appeared in the input. Kept (rather than
   * discarded) so callers can still show "already have this" in the UI
   * without a second pass over the original list.
   */
  alreadyOwned: ListItem[];
}

/**
 * Partitions a `ShoppingList`'s items into what still needs sourcing vs.
 * what's already owned.
 *
 * Return-shape design: a boolean-per-item map (`{ [name]: boolean }` or
 * similar) would force every caller to re-filter the list themselves before
 * doing anything useful with it, and is unsafe to key by `name` since list
 * item names aren't guaranteed unique (two different-unit entries can share
 * a name, e.g. "ice" for drinks vs. "ice" for a cooler). Returning the two
 * already-partitioned `ListItem[]` arrays instead means a caller (most
 * concretely `basket_update`, see basket_update.ts) can go straight to
 * `needsSourcing` without re-deriving it, while `alreadyOwned` stays
 * available for "already have this" UI without a second filter pass.
 *
 * `owned` is only ever treated as "owned" when it is literally `true`.
 * `owned === undefined` (e.g. a manually-added ListItem that never went
 * through a picker defaulting it) is treated as "not owned" / needs
 * sourcing — the safer default, since silently excluding an item from the
 * basket because of a missing flag would be a worse failure mode than
 * including it.
 */
export function checkInventory(items: ListItem[]): InventoryPartition {
  const needsSourcing: ListItem[] = [];
  const alreadyOwned: ListItem[] = [];

  for (const item of items) {
    if (item.owned === true) {
      alreadyOwned.push(item);
    } else {
      needsSourcing.push(item);
    }
  }

  return { needsSourcing, alreadyOwned };
}
