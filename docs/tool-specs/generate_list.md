# generate_list tool — spec

## Purpose
Turn a `UseCase` + a (possibly partial) `Scenario.slots` value map into a
fresh `ListItem[]` — the seed for a new `ShoppingList` the moment a user
starts a Scenario from a matched UseCase. This is a **read-once** operation:
after the initial list exists, every further edit goes through
`adjust_scenario`, never back through `generateList` (see that spec's
"never regenerate the whole list" constraint, CLAUDE.md locked decision #2).

## Contract
`generateList(useCase, scenarioSlots) -> ListItem[]`

Input:
```
useCase: {
  id: string,
  scenario_slots: Record<slot_id, slot_definition>,  // needs .default per slot
  template_list: TemplateListItem[],
}
scenarioSlots: Record<slot_id, slot_value>   // partial; unset slots fall back to each slot's default
```
Output: `ListItem[]` — one entry per `template_list_item` whose
`presence_rules` currently pass, each `{ name, qty, unit, category,
owned: false, source_item_id: item_id }`.

Also exported (specifically so `adjust_scenario.ts` can reuse them instead
of re-implementing rule evaluation — see "Shared evaluator" below):
- `resolveScenarioSlots(useCase, providedSlots) -> Record<slot_id, slot_value>`
  — merges `providedSlots` over each slot's declared `default`.
- `evaluateTemplateItem(item, resolvedSlots) -> { present: boolean; qty: number }`
  — the per-item rule evaluator (presence + qty), given a *fully resolved*
  slot map.
- `evaluatePresence` / `computeQty` — the two rule-evaluation halves,
  exported individually for direct unit testing.

## Rule semantics (see /docs/schemas/README.md for the full writeup)
- **presence_rules** — AND-combined. `equals`/`not_equals` compare an enum
  slot's value; `includes`/`excludes` test membership on a tag_list slot's
  value. No `presence_rules` (or an empty array) = always present.
- **scaling_rules** — if the item has none, qty = `qty.base`. If it has one
  or more, qty = the **sum** of each rule's independently-computed
  contribution (additive, not multiplicative — see the README's granola-bars
  worked example: 2 bars/traveler + 1/day, not travelers × days).
  - `linear`: `per_unit * slot_value`, then rounded (`round: "up"|"down"|
    "nearest"`, default `"nearest"`; `Math.ceil`/`Math.floor`/`Math.round`
    respectively), then floored at `minimum` if given.
  - `step`: the first tier (ascending by `up_to`) whose `up_to` is `null` or
    `>= slot_value` supplies the (exact, unrounded) `qty` for that tier.
  - A numeric/duration slot's "value" for scaling purposes is the slot's
    number directly (`integer` slots) or its `.count` (`duration` slots).

## Constraints
- **Pure function, no I/O** — takes the `UseCase` and slot values as
  arguments; never fetches a `UseCase` itself (that's `get_usecase`'s job,
  one layer up — see `lib/harness/tools.ts`'s `generate_list` registry
  entry, which fetches by `use_case_id` and then calls this).
- Deterministic: identical `(useCase, scenarioSlots)` always produce
  identical output.
- Every produced `ListItem` has `owned: false` (a freshly generated list has
  nothing pre-marked owned) and `source_item_id` set to the originating
  `template_list_item.item_id` — never `null` (manually-added items don't
  exist yet at generation time).
- A `qty.base` fallback is only used for items with **no** `scaling_rules`
  at all. If `scaling_rules` are present, they are always the source of
  truth for qty — even at each slot's exact default value, where the
  computed result can legitimately differ from the item's hand-authored
  `qty.base` reference value once rounding is applied (see the "Flagged
  ambiguity" note in this phase's final report / adjust_scenario.md).

## Acceptance criteria (see generate_list.test.ts for the executed versions, against the real backyard-bbq-cookout and weekend-trip-getaway seed fixtures)
- At all-default slots, produces the presence/qty the schema README's worked
  examples describe (e.g. `granola_bars` base = 7 for headcount=2,
  duration=3 days).
- A `dietary`-gated presence pair (`beef_burger_patties` /
  `veggie_burger_patties`) flips correctly when `dietary` includes `"vegan"`.
  `veggie_burger_patties` also flips off — that's checked too.
- An item gated by **two** slots at once (`string_lights`: `time_of_day` +
  `setting`, AND-combined) is only present when both conditions hold.
  Adjacent case checked: header of tests are asymmetric (each of the two
  guard conditions is tested for false-only-that-one).
- `step` scaling produces the documented tier jumps (`folding_tables`: 1 at
  headcount≤8, 2 at ≤20, 3 above).
- A slot with **zero** dependent items (`budget_tier` in both seed fixtures)
  changes nothing about the generated item set/quantities.
