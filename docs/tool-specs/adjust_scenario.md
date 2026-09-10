# adjust_scenario tool — spec

## THE constraint this tool exists to enforce

> CLAUDE.md, "Locked decisions", #2:
> **"Scenario edits PATCH affected slots/items only. Never regenerate a
> whole list from scratch on an edit — this discards user's manual
> changes."**

`adjustScenario` **never** calls `generateList` and **never** re-evaluates
every `template_list_item`. It only touches the subset of `template_list`
whose `depends_on_slots` includes the one `slot_id` being patched, and —
within that subset — only the `ListItem`s that trace back to those template
items via `source_item_id`. Every other `ListItem` (independent
template-sourced items, and any manually-added item with
`source_item_id: null`) is carried through to the output completely
untouched — the implementation (`lib/tools/adjust_scenario.ts`) carries the
*same object reference* for those, not merely an equal-looking copy, so a
regression that accidentally rebuilds the whole list is straightforward to
catch in tests (`toBe`, not just `toEqual`).

## Contract
`adjustScenario(useCase, currentScenarioSlots, currentItems, slotId, newValue) -> { slots, items }`

Input:
```
useCase: { id, scenario_slots, template_list }   // same shape generate_list takes
currentScenarioSlots: Record<slot_id, slot_value>  // partial; unset slots fall back to default
currentItems: ListItem[]                           // the ShoppingList's current items, as persisted
slotId: string                                      // must be a key of useCase.scenario_slots
newValue: slot_value                                // the slot's new value
```
Output:
```
{
  slots: Record<slot_id, slot_value>,  // currentScenarioSlots resolved + slotId patched to newValue
  items: ListItem[],                    // patched item list -- see "What changes" below
}
```
Throws `UnknownSlotError` if `slotId` isn't a declared key of
`useCase.scenario_slots` — fails loudly rather than silently no-op'ing on a
typo'd slot id.

## What changes, case by case (all five are covered by adjust_scenario.test.ts, with real backyard-bbq-cookout / weekend-trip-getaway seed data)

1. **Item depends on the changed slot, stays present.** Its `qty` is
   recomputed by re-running the *same* per-item evaluator `generate_list.ts`
   uses (`evaluateTemplateItem`) against the **full** updated slot map — not
   just the one changed slot, since a `presence_rule`/`scaling_rule` can
   reference other slots too. Every other field is preserved exactly as it
   was on the existing `ListItem` — **`owned` is never reset to `false`**
   just because `qty` changed, and neither is any other field a user might
   have edited (e.g. a renamed `name`).
2. **Item depends on the changed slot, was absent, now present** (a
   `presence_rule` now passes). Added as a brand-new `ListItem`
   (`owned: false` — there is no prior user state to preserve, since the
   item didn't exist on the list before this patch).
3. **Item depends on the changed slot, was present, now absent** (a
   `presence_rule` now fails). Removed from `items[]`. If the user had
   marked it `owned` (or otherwise edited it), **that state is dropped along
   with the item.** This is deliberate: the item is no longer relevant to
   the scenario (e.g. "veggie burger patties" once `dietary` no longer
   includes `"vegan"`), so there's nothing meaningful left to preserve it
   *as*. This is explicitly **not** an instance of the "discard user edits"
   failure CLAUDE.md's locked decision #2 warns about — that failure mode is
   regenerating the *whole list* and silently wiping out *unrelated* items'
   edits; this is scoped removal of the one item whose presence condition
   itself just changed.
4. **Item's `depends_on_slots` does NOT include the changed slot.** Left
   byte-for-byte untouched — same object reference in the output array.
5. **Manually-added item (`source_item_id: null`).** Never touched, for any
   `slotId` — there is no template item to recompute it against, by
   construction (a `null` `source_item_id` can never match a
   `template_list_item.item_id`).

## Constraints
- **Reuses `generate_list.ts`'s rule evaluator** (`evaluateTemplateItem`,
  `resolveScenarioSlots`) rather than re-implementing presence/scaling logic
  — one place decides how a `presence_rule`/`scaling_rule` evaluates, used
  by both the "generate from scratch" and "patch in place" code paths, so
  they can't silently drift apart.
- Pure function, no I/O — same as `generate_list`. The harness registry
  (`lib/harness/tools.ts`) is what fetches the `UseCase` by
  `use_case_id` before calling this.
- Never mutates `currentItems` or any item in it — returns new arrays/objects
  for anything that changes, original references for anything that doesn't.
- Does not validate `newValue` against the slot's declared type/options
  (e.g. that an enum's new value is one of its `options`) — out of scope for
  this phase; a caller wiring this up to real user input should validate
  against `useCase.scenario_slots[slotId]` first. Flagged, not silently
  guessed at: see this phase's final report.

## Acceptance criteria
See `lib/tools/adjust_scenario.test.ts` for the executed versions of all
five cases above, plus:
- Recomputes correctly when a `presence_rule` depends on **two** slots and
  only one of them is the one being patched (`string_lights`: patching
  `setting` alone, or `time_of_day` alone, both correctly re-evaluate
  against the full slot map, not just the just-patched value).
- Patching a slot with **zero** dependent items (e.g. `budget_tier`) updates
  `slots` but leaves every `ListItem` byte-for-byte untouched.
- An item scaled by **two** numeric slots (`granola_bars`: `headcount` +
  `duration`) recomputes correctly when only one of the two is patched.
- `UnknownSlotError` on an undeclared `slotId`.
