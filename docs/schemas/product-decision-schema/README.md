# Product decision schema

This directory is the decision-vector layer behind the agentic product detail
page: for a given product category, *what should the user actually weigh
before buying*, and *how does that get personalized per user*. It is
generated per department, one department at a time — this first pass covers
**Apparel & Accessories**.

It is **not** the same taxonomy as `../category-taxonomy.json`. That file is
this app's own use-case taxonomy (`events` / `travel` / `home` / `seasonal`,
4×13), used to classify use cases and match user intent. This directory is
keyed to the **Google product taxonomy** (the category tree in the uploaded
`Category<>Count` workbook — 27 departments, 11,557 leaf categories, sourced
from real e-commerce category data), because that's the taxonomy real
products (from `resolve_products`) actually fall into. A `ListItem`'s
`category` field is this app's taxonomy; a *resolved product* sits somewhere
in this one. The two are related but distinct, and a product detail page
needs the second.

## Files

- `archetypes.apparel.json` — 30 **archetypes**: clusters of leaf categories
  that share the same real purchase decision (e.g. "everyday tops",
  "footwear", "fine jewelry"). Each archetype carries 5–7 **decision
  vectors** (what to weigh, why it matters, how to evaluate it, where the
  data comes from), a `personalization` block, and a one-line `best_way_to_buy`
  heuristic.
- `leaf-mapping.apparel.json` — all 403 Apparel & Accessories leaf categories,
  each mapped to exactly one archetype id.
- `_apparel-leaves.json` — the raw input: leaf category paths + product
  counts, extracted from the workbook's category tree. Not consumed
  directly by the app; kept so the mapping is regenerable.
- `../../../scripts/generate-apparel-decision-schema.py` — the generator.
  `classify()` assigns each leaf to an archetype id by matching its ancestor
  path; `ARCHETYPES` holds the hand-written schema per archetype id. The
  script fails loudly if any leaf doesn't resolve to a known archetype, so
  the two stay in sync by construction.

## Why archetypes, not one schema per leaf category

403 leaf categories is too many to hand-author a decision schema for one at
a time, and it only gets worse across the other 22 departments (11,557
leaves total). Almost all of that variation is really the same handful of
purchase decisions repeating with different labels — a t-shirt and a polo
shirt are the same decision (size/fit, fabric, occasion, season, price), a
sneaker and a sandal are the same decision (size/width, activity, material,
durability, price) applied to different products. Clustering leaves into
~30 archetypes that each get one authored schema cuts the authoring surface
by roughly 13x while still giving every leaf category real, specific
decision vectors — rather than either 403 near-duplicate schemas or one
generic schema that's useless for everything.

The clustering is **structural** (it matches ancestor category names in the
taxonomy path — `"Baby & Children's Clothing"` anywhere in the path always
wins, `Activewear` always wins over garment type, etc. — see
`classify()`), not keyword-guessed on the leaf name alone, because leaf
names repeat across completely different decisions (`T-Shirts` appears
under `Clothing Tops`, `Activewear Tops`, `Baby & Children's Tops`, and
`Maternity Tops` — four different archetypes, same leaf name).

## How this plugs into the agentic product detail page

An archetype's `decision_vectors` are the **fixed** set of things that
matter for that kind of product — they don't change per user. Personalization
is a second, thinner layer on top: each archetype's `personalization` block
names which of this app's existing memory/scenario fields should *weight or
filter* those vectors for a given session:

- `durable_memory_inputs` — fields from `UserMemory` (`budget_tier`,
  `brand_prefs`, `household_size`, ...). Global, cross-session.
- `session_scenario_inputs` — fields from the current `Scenario.slots`
  (`setting`, `duration`, `time_of_day`, ...). Local to this list/event.

This keeps the memory boundary from `CLAUDE.md` intact: a category's
decision vectors are never user-specific, and a user's weighting is never
promoted into a new global vector. A future `evaluate_products` tool (not
built yet) would take {archetype's decision vectors + the resolved weights
for this user/session + candidate products from `resolve_products`} and
return a ranked, explained shortlist plus a "best way to buy" pick — the
`best_way_to_buy` string on each archetype is the seed heuristic for that.

## Extending to other departments

To do this for another department (e.g. Home & Garden):

1. Extract that department's leaf categories from the taxonomy the same way
   `_apparel-leaves.json` was produced (path + product count per leaf).
2. Write a `classify()` for that department's leaves and an `ARCHETYPES`
   dict of decision-vector schemas, following the same shape as
   `generate-apparel-decision-schema.py`.
3. Run it, confirm zero leaves are unmatched (the script raises if any are),
   and review the resulting archetype list — a handful of archetypes with
   very few leaves is a sign two archetypes should probably merge; a huge
   catch-all archetype is a sign one should split.

Expect somewhere between ~15 and ~40 archetypes per department depending on
how varied its leaf categories are — Apparel & Accessories landed on 30 for
403 leaves; a more homogeneous department (e.g. one dominated by a single
product type) will need far fewer.
