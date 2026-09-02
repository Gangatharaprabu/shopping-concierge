# Use-case taxonomy & schema

This directory is the schema layer for shopping use cases. It does **not**
contain the 1000+ use cases themselves — that content is generated later by
`usecase-content-agent`, validated against the files here.

Files:
- `category-taxonomy.json` — canonical category/subcategory tree (data +
  enum defs).
- `use-case.schema.json` — formal JSON Schema (draft 2020-12) for `UseCase`,
  `Scenario`, `scenario_slots`, `TemplateListItem`, and `ListItem`.
- This README — field-by-field explanation and worked examples.

This is prototype-scale documentation for a ~100-user app, not a public API
spec — it favors being explicit and readable over exhaustive.

## Where the category tree lives

`category-taxonomy.json` is the single source of truth. It has two parts:

1. `$defs.category` and `$defs.subcategory` — flat string enums. These are
   normative and are `$ref`'d directly from `use-case.schema.json`
   (`UseCase.category`, `UseCase.subcategory`), so any validator that
   validates a `UseCase` against `use-case.schema.json` automatically
   enforces category/subcategory values against this list.
2. `x-tree` — a non-normative, human-readable rendering of the same tree,
   with a label, one-line description, and 2 example use-case titles per
   subcategory. `x-tree` is ignored by JSON Schema validators (it's outside
   any `$ref`'d fragment); it exists to brief `usecase-content-agent` on
   what belongs in each subcategory when it generates content.

The tree is two levels: **category** (4 top-level: `events`, `travel`,
`home`, `seasonal`) → **subcategory** (13 per category, 52 total, ids
namespaced as `<category>.<subcategory>`, e.g. `events.bbq_grilling`).
Subcategories are the unit that's meant to hold many individual use cases —
e.g. `events.bbq_grilling` isn't itself one use case, it's a bucket that can
hold "backyard cookout for 6", "Fourth of July grill party for 30", "vegan
BBQ night", etc. At roughly 20 use cases per subcategory this scales past
1000 without needing a third tree level; if a subcategory later gets too
broad, split it (add a new subcategory id, never repurpose an existing one —
see the note in `category-taxonomy.json`'s top-level `description`).

`UseCase.tags[]` is separate from the tree and not enumerated anywhere — it's
freeform, used for embedding/similarity search (`feed-agent`), not for
navigation. A use case's place in the tree is always `category` +
`subcategory`; `tags` are extra signal on top.

## scenario_slots — the six canonical slots

`UseCase.scenario_slots` is an object keyed by `slot_id` (the "stable slot
key" the task calls for — the object's property name *is* the id, so it's
directly referenceable, not buried in an unstructured blob). Each value is a
**slot definition**: type + allowed values/range + default. Six ids are
reserved with a fixed meaning (`$defs.canonical_slot_id`):

| slot_id | type | covers |
|---|---|---|
| `time_of_day` | `enum` | day / night |
| `headcount` | `integer` | party size / travelers |
| `setting` | `enum` | indoor / outdoor (/ mixed) |
| `budget_tier` | `enum` | low / mid / high |
| `dietary` | `tag_list` | dietary constraint tags |
| `duration` | `duration` | single event vs. multi-day (+ day count) |

A `UseCase` only declares the slots that are actually relevant to it — a
home-setup use case can omit `duration` and `time_of_day` entirely; a travel
use case can omit `setting`. A `UseCase` may also invent extra slot ids
beyond these six (e.g. `grill_type`) as long as they follow the same
`^[a-z][a-z0-9_]*$` pattern; those aren't reserved, so their meaning is local
to that use case.

`duration` uses a small object rather than a bare enum so it can carry both
the single/multi-day distinction *and* the actual day count in one slot:
`{ unit: "event", count: 1 }` vs. `{ unit: "days", count: 3 }`.

`UseCase.scenario_slots` holds **definitions** (type/options/default — what
a UI would use to render a picker). `Scenario.slots` (the per-session,
patchable object from CLAUDE.md's `Scenario: { use_case_id, slots{} }`) holds
only the **current resolved value** per slot, using the same keys. Keeping
these separate means patching a Scenario never has to touch or re-derive the
definition data.

## depends_on_slots and scaling — why, and how patching works

The hard requirement driving this part of the schema: `adjust_scenario` must
be able to patch **one slot** (say `headcount` 6 → 20) and know exactly
which `template_list` items might need to change, without recomputing or
re-reading the whole list.

Every `template_list_item` carries `depends_on_slots: string[]` — every slot
id that affects whether the item is included and/or how much of it is
needed. This is the traceability mechanism: when one slot is patched, the
harness filters `template_list` (or the already-instantiated
`ListItem[]`, via `source_item_id`) down to items whose `depends_on_slots`
contains that slot id, and only recomputes those. Items with
`depends_on_slots: []` are static and are never touched by any patch — e.g.
"grill tongs" (always exactly one pair, regardless of headcount).

Two independent mechanisms sit under `depends_on_slots`, because "does this
item change" splits into two different questions:

- **`presence_rules`** — should the item be in the list *at all*, given the
  current value of an `enum`/`tag_list` slot? E.g. "veggie burger patties"
  has `presence_rules: [{ slot_id: "dietary", condition: "includes", value:
  "vegan" }]` — it only appears once `dietary` includes `"vegan"`. Multiple
  `presence_rules` on one item are AND-combined.
- **`scaling_rules`** — once present, how much of it is needed, as a
  function of a numeric (`integer`/`duration`) slot? Two methods:
  - `linear`: `total = per_unit * slot_value` (rounded). E.g. charcoal
    briquettes: `per_unit: 0.3` kg per guest.
  - `step`: quantity jumps at thresholds rather than scaling smoothly. E.g.
    coolers: 1 up to 10 guests, 2 up to 25, 3 above that — you don't want a
    formula suggesting 2.3 coolers.

  If an item has more than one `scaling_rule` (i.e. it's driven by two
  numeric slots, e.g. a snack that scales a bit with `headcount` and a bit
  with `duration`), the contributions are summed independently. This is an
  intentional, documented simplification: it handles "a bit more per extra
  guest, plus a bit more per extra day" additively, but it does **not**
  model a truly multiplicative relationship (e.g. "outfits" = travelers ×
  days exactly). For a prototype at this scale, template authors handle
  genuinely multiplicative items by picking one dominant slot to scale on
  and folding a typical value of the other into the constant, rather than
  the schema growing a formula DSL for it.

  Every `slot_id` used in an item's `presence_rules` or `scaling_rules` must
  also appear in that item's `depends_on_slots` — this is a semantic
  constraint (not directly checkable by JSON Schema alone) that
  `usecase-content-agent`'s validation script should lint for when it
  batch-validates generated content.

`qty.base` is the quantity at each dependent slot's *default* value — it's
what seeds the `ShoppingList` the moment a user picks this `UseCase`, before
any edits. After that, `scaling_rules` (not `qty.base`) are the source of
truth for recomputing quantity on a patch.

`ListItem` (the live, per-session, user-editable line on a `ShoppingList`)
adds `source_item_id`, pointing back to the `template_list_item.item_id` it
was instantiated from (`null` if the user added it manually). This is what
lets `adjust_scenario` find "the tongs" or "the charcoal" in an already-built
`ShoppingList.items[]` by id rather than by matching on `name` (which the
user may have edited).

## Memory boundary: Scenario slots vs. UserMemory

`budget_tier` and `dietary` exist on both `UserMemory` (durable, global —
`CLAUDE.md`'s canonical model) and `Scenario.slots` (session-specific, from
this schema). They are not the same field reused — they're a default/override
pair:

- When a `Scenario` is created from a `UseCase`, the harness pre-fills
  `slots.budget_tier` / `slots.dietary` from the user's `UserMemory` if the
  user has one set, falling back to the slot's own `default` from
  `scenario_slots` otherwise.
- The user can then override either at the scenario level — e.g. this one
  BBQ is a splurge (`budget_tier: "high"` for just this event) even though
  their durable `budget_tier` is `"mid"`, or this one dinner needs to be
  nut-free for a guest even though the user personally has no dietary
  restriction in `UserMemory`.
- That override is written **only** to `Scenario.slots` / the resulting
  `ShoppingList`. It is never promoted back to `UserMemory` — per CLAUDE.md's
  locked memory-boundary rule, only durable, user-level facts go through
  `memory_write`; one event's context is not the user's global preference.

Same pattern applies to any other slot that happens to resemble a
`UserMemory` field in the future: `Scenario.slots` values default from
`UserMemory` but are session-scoped and disposable.

## Worked examples

### 1. Backyard BBQ Cookout (`events.bbq_grilling`)

Illustrates: static items, `headcount` linear scaling, `headcount` step
scaling, a `dietary`-gated presence pair, an item gated by **two** slots at
once, and a slot (`budget_tier`) that no item depends on at all.

```json
{
  "id": "backyard-bbq-cookout",
  "title": "Backyard BBQ Cookout",
  "description": "Hosting a casual grill-out for friends or family.",
  "category": "events",
  "subcategory": "events.bbq_grilling",
  "tags": ["grilling", "summer", "outdoor"],
  "scenario_slots": {
    "time_of_day": { "type": "enum", "label": "Time of day", "options": ["day", "night"], "default": "day" },
    "headcount": { "type": "integer", "label": "Guests", "min": 2, "max": 100, "default": 8, "unit": "guests" },
    "setting": { "type": "enum", "label": "Setting", "options": ["outdoor", "indoor", "mixed"], "default": "outdoor" },
    "budget_tier": { "type": "enum", "label": "Budget", "options": ["low", "mid", "high"], "default": "mid" },
    "dietary": { "type": "tag_list", "label": "Dietary needs", "options": ["vegetarian", "vegan", "gluten_free", "nut_free"], "default": [] }
  },
  "template_list": [
    {
      "item_id": "grill_tongs",
      "name": "Grill tongs",
      "category": "gear",
      "qty": { "base": 1, "unit": "pair" },
      "depends_on_slots": []
    },
    {
      "item_id": "charcoal_briquettes",
      "name": "Charcoal briquettes",
      "category": "fuel",
      "qty": { "base": 2.4, "unit": "kg" },
      "depends_on_slots": ["headcount"],
      "scaling_rules": [{ "slot_id": "headcount", "method": "linear", "per_unit": 0.3, "round": "up", "minimum": 1 }]
    },
    {
      "item_id": "beef_burger_patties",
      "name": "Beef burger patties",
      "category": "food",
      "qty": { "base": 8, "unit": "count" },
      "depends_on_slots": ["headcount", "dietary"],
      "presence_rules": [{ "slot_id": "dietary", "condition": "excludes", "value": "vegan" }],
      "scaling_rules": [{ "slot_id": "headcount", "method": "linear", "per_unit": 1, "round": "up" }]
    },
    {
      "item_id": "veggie_burger_patties",
      "name": "Veggie burger patties",
      "category": "food",
      "qty": { "base": 0, "unit": "count" },
      "depends_on_slots": ["headcount", "dietary"],
      "presence_rules": [{ "slot_id": "dietary", "condition": "includes", "value": "vegan" }],
      "scaling_rules": [{ "slot_id": "headcount", "method": "linear", "per_unit": 1, "round": "up" }],
      "notes": "Absent by default (dietary default is []); qty.base is unused while excluded."
    },
    {
      "item_id": "folding_tables",
      "name": "Folding tables",
      "category": "gear",
      "qty": { "base": 1, "unit": "count" },
      "depends_on_slots": ["headcount"],
      "scaling_rules": [{ "slot_id": "headcount", "method": "step", "tiers": [{ "up_to": 8, "qty": 1 }, { "up_to": 20, "qty": 2 }, { "up_to": null, "qty": 3 }] }]
    },
    {
      "item_id": "string_lights",
      "name": "Outdoor string lights",
      "category": "decor",
      "qty": { "base": 1, "unit": "set" },
      "depends_on_slots": ["time_of_day", "setting"],
      "presence_rules": [
        { "slot_id": "time_of_day", "condition": "equals", "value": "night" },
        { "slot_id": "setting", "condition": "equals", "value": "outdoor" }
      ],
      "notes": "Item affected by two slots at once (AND-combined) — only shows up for an outdoor night BBQ."
    }
  ]
}
```

If a user patches `headcount` from 8 to 25: the harness looks at
`depends_on_slots` across `template_list` and only touches `charcoal_briquettes`
(2.4kg → step to ~7.5kg), `beef_burger_patties`/`veggie_burger_patties` (qty
recompute, presence unchanged), and `folding_tables` (1 → 3, step tier).
`grill_tongs` and `string_lights` are untouched. `budget_tier` isn't
referenced by any item's `depends_on_slots` — patching it changes nothing in
`template_list`; it still flows straight through to `resolve_products` as
`user_budget_tier` (see `/docs/tool-specs/resolve_products.md`) to influence
*which products* get matched, without adding/removing/resizing any item.
That's the "slot that doesn't affect the list at all" case.

### 2. Weekend Trip (`travel.weekend_trip`)

Illustrates: the `duration` slot, an item scaled by two numeric slots
additively (documented limitation above), and reuse of `budget_tier` again
with zero list dependents — this time on a category where it would be easy
to *assume* it should scale something, and it still doesn't.

```json
{
  "id": "weekend-trip-getaway",
  "title": "Weekend Trip",
  "description": "A short getaway, 2-4 days, for a couple or small group.",
  "category": "travel",
  "subcategory": "travel.weekend_trip",
  "tags": ["packing", "short-trip"],
  "scenario_slots": {
    "headcount": { "type": "integer", "label": "Travelers", "min": 1, "max": 8, "default": 2, "unit": "travelers" },
    "duration": { "type": "duration", "label": "Trip length", "max_days": 14, "default": { "unit": "days", "count": 3 } },
    "budget_tier": { "type": "enum", "label": "Budget", "options": ["low", "mid", "high"], "default": "mid" },
    "dietary": { "type": "tag_list", "label": "Dietary needs", "default": [] }
  },
  "template_list": [
    {
      "item_id": "phone_charger",
      "name": "Phone charger",
      "category": "electronics",
      "qty": { "base": 1, "unit": "count" },
      "depends_on_slots": []
    },
    {
      "item_id": "toothbrush",
      "name": "Toothbrush",
      "category": "toiletries",
      "qty": { "base": 2, "unit": "count" },
      "depends_on_slots": ["headcount"],
      "scaling_rules": [{ "slot_id": "headcount", "method": "linear", "per_unit": 1 }]
    },
    {
      "item_id": "granola_bars",
      "name": "Granola bars",
      "category": "food",
      "qty": { "base": 7, "unit": "bars" },
      "depends_on_slots": ["headcount", "duration"],
      "scaling_rules": [
        { "slot_id": "headcount", "method": "linear", "per_unit": 2 },
        { "slot_id": "duration", "method": "linear", "per_unit": 1 }
      ],
      "notes": "Additive: 2 bars per traveler + 1 per day, not travelers x days."
    }
  ]
}
```

Base check: `headcount` default 2, `duration` default 3 days →
`granola_bars` base = 2*2 + 1*3 = 7, matching `qty.base`. Patching `duration`
from 3 to 7 days recomputes only `granola_bars` (2*2 + 1*7 = 11) and leaves
`phone_charger`/`toothbrush` untouched, since neither has `duration` in
`depends_on_slots`.

### 3. First Apartment Essentials (`home.new_apartment_setup`)

Illustrates: a `UseCase` that only needs one slot at all (no `headcount`,
`duration`, `time_of_day`, or `setting` — none of those axes are meaningful
for stocking an apartment), and `budget_tier` this time *does* gate an item
via `presence_rules`, in contrast to examples 1 and 2 where it gated nothing.
The same canonical slot can matter a lot or not at all, per use case.

```json
{
  "id": "first-apartment-essentials",
  "title": "First Apartment Essentials",
  "category": "home",
  "subcategory": "home.new_apartment_setup",
  "tags": ["move-in", "kitchen", "starter-kit"],
  "scenario_slots": {
    "budget_tier": { "type": "enum", "label": "Budget", "options": ["low", "mid", "high"], "default": "mid" }
  },
  "template_list": [
    {
      "item_id": "broom_and_dustpan",
      "name": "Broom and dustpan",
      "category": "cleaning",
      "qty": { "base": 1, "unit": "set" },
      "depends_on_slots": []
    },
    {
      "item_id": "basic_cookware_set",
      "name": "Basic cookware set",
      "category": "kitchen",
      "qty": { "base": 1, "unit": "set" },
      "depends_on_slots": ["budget_tier"],
      "presence_rules": [{ "slot_id": "budget_tier", "condition": "not_equals", "value": "high" }]
    },
    {
      "item_id": "premium_cookware_set",
      "name": "Premium cookware set",
      "category": "kitchen",
      "qty": { "base": 0, "unit": "set" },
      "depends_on_slots": ["budget_tier"],
      "presence_rules": [{ "slot_id": "budget_tier", "condition": "equals", "value": "high" }]
    }
  ]
}
```

## Deliberate omissions

- No `ShoppingList` or `Basket` schema here — out of scope for this task per
  `CLAUDE.md`; `Basket` in particular must stay ordering/checkout-free.
- No cross-file JSON Schema validation of the "every `presence_rules`/
  `scaling_rules` slot_id must be in `depends_on_slots`" rule or of
  "`slot_definition.default` must be one of its own `options`" — both are
  simple, well-defined lint rules that `usecase-content-agent`'s batch
  validator should implement in code rather than the schema growing custom
  keywords for them.
