/**
 * adjust_scenario tool
 *
 * Contract: /docs/tool-specs/adjust_scenario.md (read that first -- this file
 * implements it, doesn't redefine it).
 *
 * ============================================================================
 * THE CONSTRAINT THIS FILE EXISTS TO ENFORCE -- CLAUDE.md locked decision #2:
 *
 *   "Scenario edits PATCH affected slots/items only. Never regenerate a whole
 *   list from scratch on an edit -- this discards user's manual changes."
 *
 * adjustScenario NEVER calls generateList (or re-evaluates every
 * template_list_item). It only touches the subset of `template_list` whose
 * `depends_on_slots` includes the one slot_id being patched -- found via
 * `useCase.template_list.filter(item => item.depends_on_slots.includes(slotId))`
 * -- and, within that subset, only the ListItems that trace back to those
 * template items via `source_item_id`. Every other ListItem (independent
 * template-sourced items, and any manually-added item with
 * `source_item_id: null`) is carried through to the output completely
 * untouched -- same object reference, not just deep-equal-by-accident.
 * ============================================================================
 */

import type { ListItem } from "../types";
import {
  evaluateTemplateItem,
  resolveScenarioSlots,
  type SlotValue,
  type UseCaseForList,
} from "./generate_list";

export interface AdjustScenarioResult {
  /** The fully-resolved slot map after applying the patch (previous slots, defaults-filled, with slotId overridden). */
  slots: Record<string, SlotValue>;
  /** The patched ShoppingList.items[] -- see file header for exactly what is/isn't touched. */
  items: ListItem[];
}

/** Thrown when `slotId` isn't one of `useCase.scenario_slots`' declared keys. */
export class UnknownSlotError extends Error {
  constructor(slotId: string, useCaseId: string) {
    super(`adjust_scenario: "${slotId}" is not a declared scenario_slots key on use case "${useCaseId}"`);
    this.name = "UnknownSlotError";
  }
}

/**
 * Patches exactly one scenario slot and recomputes exactly the ShoppingList
 * items affected by that slot -- never the whole list. See file header.
 *
 * @param useCase                The originating UseCase (needs `scenario_slots` + `template_list`).
 * @param currentScenarioSlots   The Scenario's current slots{} (may be partial; missing keys fall back to each slot's default, same as generateList).
 * @param currentItems           The ShoppingList's current items[] (as persisted, including any owned/manually-added items).
 * @param slotId                 The single slot being changed.
 * @param newValue                Its new value.
 *
 * Handling of each case (see /docs/tool-specs/adjust_scenario.md for the full writeup and CLAUDE.md's locked decision #2):
 *  - Item depends on slotId, stays present: qty is recomputed against the
 *    *full* updated slot map (not just the changed slot, since a rule can
 *    reference other slots too); every other field on the existing ListItem
 *    -- crucially `owned`, but also any user-edited `name` -- is preserved
 *    as-is. Only `qty` changes.
 *  - Item depends on slotId, was absent, now present (a presence_rule now
 *    passes): added as a new ListItem (owned: false -- there is no prior
 *    user state to preserve, it didn't exist).
 *  - Item depends on slotId, was present, now absent (a presence_rule now
 *    fails): removed from items[]. If the user had marked it `owned` (or
 *    otherwise touched it), that state is dropped along with the item --
 *    this is a deliberate, documented consequence of the item no longer
 *    being relevant to the scenario (e.g. "veggie burger patties" once
 *    `dietary` no longer includes "vegan"), not an instance of the
 *    "discard user edits" bug CLAUDE.md warns about (that bug is regenerating
 *    the *whole list*, wiping out unrelated items' edits -- this is scoped
 *    removal of the one item that's no longer meaningful).
 *  - Item's `depends_on_slots` does NOT include slotId: left byte-for-byte
 *    untouched (same object reference carried into the result array).
 *  - Manually-added item (`source_item_id: null`): never touched -- there is
 *    no template item to recompute it against, so it always falls into the
 *    "untouched" path regardless of slotId.
 */
export function adjustScenario(
  useCase: UseCaseForList,
  currentScenarioSlots: Record<string, unknown>,
  currentItems: ListItem[],
  slotId: string,
  newValue: unknown,
): AdjustScenarioResult {
  if (!(slotId in useCase.scenario_slots)) {
    throw new UnknownSlotError(slotId, useCase.id);
  }

  // Resolve the *current* slots (filling in defaults for anything unset),
  // then apply the one-slot patch on top -- this is the full slot map every
  // affected item's presence_rules/scaling_rules get re-evaluated against,
  // since those can reference slots other than the one that just changed.
  const resolvedCurrentSlots = resolveScenarioSlots(useCase, currentScenarioSlots);
  const newSlots: Record<string, SlotValue> = {
    ...resolvedCurrentSlots,
    [slotId]: newValue as SlotValue,
  };

  const affectedTemplateItems = useCase.template_list.filter((item) => item.depends_on_slots.includes(slotId));
  const affectedById = new Map(affectedTemplateItems.map((item) => [item.item_id, item]));

  const handledSourceIds = new Set<string>();
  const items: ListItem[] = [];

  for (const listItem of currentItems) {
    const templateItem =
      listItem.source_item_id != null ? affectedById.get(listItem.source_item_id) : undefined;

    if (!templateItem) {
      // Not tied to an affected template item -- either a manually-added
      // item (source_item_id: null) or a template-sourced item whose
      // depends_on_slots doesn't include slotId. Untouched, same reference.
      items.push(listItem);
      continue;
    }

    handledSourceIds.add(templateItem.item_id);
    const evaluation = evaluateTemplateItem(templateItem, newSlots);

    if (!evaluation.present) {
      // Presence rule now fails -- drop the item. See file header for why
      // this is intentional, not the "discard edits" failure mode.
      continue;
    }

    // Recompute qty only; preserve every other field the user may have set
    // (owned, any edited name, category, unit, source_item_id).
    items.push({ ...listItem, qty: evaluation.qty });
  }

  // Affected template items that had no corresponding existing ListItem yet
  // (they were previously absent, i.e. never instantiated) but now pass
  // their presence_rules: add them as new ListItems.
  for (const templateItem of affectedTemplateItems) {
    if (handledSourceIds.has(templateItem.item_id)) continue;

    const evaluation = evaluateTemplateItem(templateItem, newSlots);
    if (evaluation.present) {
      items.push({
        name: templateItem.name,
        qty: evaluation.qty,
        unit: templateItem.qty.unit,
        category: templateItem.category,
        owned: false,
        source_item_id: templateItem.item_id,
      });
    }
  }

  return { slots: newSlots, items };
}
