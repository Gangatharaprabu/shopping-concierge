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
  heuristic. Every decision vector also carries a `catalog_attribute` — the
  machine-usable half, described below.
- `attribute-types.apparel.json` — the 15 reusable catalog-attribute *shapes*
  (`size_enum`, `price_tier`, `material_spec`, ...) that `catalog_attribute`
  entries are resolved from. Reference only; not needed to consume
  `archetypes.apparel.json`, which already has each attribute fully resolved.
- `leaf-mapping.apparel.json` — all 403 Apparel & Accessories leaf categories,
  each mapped to exactly one archetype id.
- `_apparel-leaves.json` — the raw input: leaf category paths + product
  counts, extracted from the workbook's category tree. Not consumed
  directly by the app; kept so the mapping is regenerable.
- `../../../scripts/generate-apparel-decision-schema.py` — the generator.
  `classify()` assigns each leaf to an archetype id by matching its ancestor
  path; `ARCHETYPES` holds the hand-written narrative schema per archetype
  id. The script fails loudly if any leaf doesn't resolve to a known
  archetype, so the two stay in sync by construction.
- `../../../scripts/apparel_catalog_attributes.py` — `ATTRIBUTE_TYPES` (the
  registry) and `VECTOR_ATTRIBUTES` (which type + overrides each decision
  vector uses). The generator fails loudly if any decision vector has no
  entry here, same guarantee as `classify()`.
- `catalog-source-cos.json` — the schema above, checked against a real
  catalog sample instead of assumed. See "Grounding against a real catalog
  sample" below.
- `../../../scripts/generate-cos-catalog-binding.py` — regenerates it from
  the source workbook.

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

## The catalog-attribute layer: from "what to weigh" to a runtime match

`decision_vectors[].why_it_matters` / `how_to_evaluate` are for a human (or
an LLM prompt) reading the schema. `decision_vectors[].catalog_attribute` is
for code: it says what a catalog item needs to carry for that vector, and
how to compare it against the user at PDP render time, without an LLM call
in the hot path.

```json
"catalog_attribute": {
  "attribute_type": "size_numeric",
  "catalog_field": "ring_size,chain_length_in",
  "value_type": "number",
  "required": true,
  "personalization_match": {
    "source": "size_profile",
    "field": "size_profile.jewelry",
    "match_type": "range_overlap",
    "pdp_surface": "fit_badge",
    "proposed_memory_extension": true
  }
}
```

- `catalog_field` — the field(s) this needs to exist on the catalog item
  (or be extracted from the product listing your source provides).
- `value_type` / `unit` / `allowed_values` — the shape of that field.
- `required` — whether the PDP can render meaningfully without it.
- `personalization_match.source` — where the comparison value comes from:
  `user_memory` (existing `UserMemory` field), `scenario_slot` (existing
  `Scenario.slots` field), `order_history` (derived from past
  `ShoppingList`/`Basket` items — data that already exists, just needs
  aggregating), `size_profile` (see below), or `display_only` (no match —
  the attribute is shown/filterable on the PDP but never compared to the
  user).
- `match_type` — `exact_equals`, `range_overlap`, `threshold_lte`/`gte`,
  `categorical_preference_score`, `flag_if_missing`, or `not_applicable`.
- `pdp_surface` — what rendering this drives: `fit_badge`,
  `why_this_fits_chip`, `warning_banner`, `sort_boost`, `filter_facet`,
  `comparison_column`, or `spec_row`.

Every attribute type and every vector's specific mapping is defined once —
`attribute-types.apparel.json` for the reusable shape,
`apparel_catalog_attributes.py`'s `VECTOR_ATTRIBUTES` for which vectors use
it — and the generator resolves them together, so `archetypes.apparel.json`
ships fully flattened and self-contained.

### The gap this surfaces: `size_profile` doesn't exist yet

A large share of what actually drives apparel PDP personalization — top
size, shoe size and width, ring size, wrist size, bra band/cup, hair color —
is a **durable, cross-session body/fit fact about the user**, exactly the
kind of thing `memory_write` is for. But today's `UserMemory` only has
`household_size`, `dietary_prefs`, `budget_tier`, `brand_prefs` — no
size/fit profile at all. Every `personalization_match` that needs one is
marked `"proposed_memory_extension": true` rather than silently assumed, so
this is visible rather than papered over: **building the personalized PDP
for real requires adding a `size_profile` object to `UserMemory` first**
(same durable, global-to-the-user boundary as the existing fields — this
isn't a new kind of memory, just a field this app hasn't needed until now).
Until that exists, every `size_profile`-sourced attribute still has a
fallback: `display_only` with the size chart surfaced to the user directly,
same as today's `resolve_products` flow.

## Grounding against a real catalog sample (COS)

`catalog-source-cos.json` checks the schema above against
`FixedAttributeSample_COS_15thSept2026.xlsx` — 1000 real COS product rows
(916 resolved to one of our archetypes; the rest had malformed or
unparseable category data, which is realistic for a live feed). For every
decision vector on an archetype the sample actually covers, it records the
**real field path** that answers it, computed from the data rather than
assumed:

```json
"face_shape_fit": {
  "real_field": "meta.productAttributes.suitability.face_shape",
  "gap": false,
  "note": "this is exactly the vector that matters most for sunglasses, and it's the one most often empty — 0/3 rows populated in this sample"
}
```

11 of the 30 archetypes are represented in this sample (mostly core
apparel — tops, bottoms, dresses, outerwear — plus jewelry, headwear,
belts, hosiery, sunglasses, gloves, scarves); the other 19, including
`footwear` and `bags_wallets_cases`, aren't present in these 1000 rows at
all, so there's nothing to ground yet.

**What this validated:**

- The universal signals proposed earlier turned out to already be real
  catalog columns: `rating`/`rating_count`, `instock`, `return_policy`,
  `price`/`original_price`/`onsale` all exist in this feed's contract.
- The `meta.productAttributes.suitability` block is a real, populated field
  carrying exactly the kind of appearance/body data (`body_type`,
  `skin_tone`, `hair_color`, `face_shape`, `occasion`, `season`) the
  proposed `size_profile` memory extension would need to match against —
  independent confirmation this personalization approach is realistic, not
  invented.

**What this refined, with real numbers instead of guesses:**

- `rating`/`rating_count` are **0/916 populated** in this feed —
  columns exist, this retailer's data doesn't. A PDP built on this source
  cannot show a review badge; `universal_signals.reviews` documents this as
  a source gap, not a schema one.
- `return_policy` is **27/916 populated (<3%)**, and several of the
  populated values are actually wash-care text misfiled into that column —
  a data-quality problem on top of the coverage problem.
- `suitability` population is inconsistent and often low even within one
  retailer: 68% of outerwear rows carry it, but only 29% of dresses, 17% of
  headwear, and 0% of the (admittedly tiny, n=1–2) scarves and gloves
  samples. Any vector that leans on `suitability` needs a real fallback for
  when it's empty, not an assumption it's there.
- **15 vector-level gaps**: decision vectors that matter (per
  `archetypes.apparel.json`) but this catalog has no structured field for
  at all — e.g. outerwear's `warmth_insulation` and `weather_protection`
  (only a qualitative fabric-weight string, no rating), sunglasses'
  `uv_protection_lens_category` and `prescription_compatibility` (not
  modeled anywhere), fine jewelry's `metal_type_hypoallergenic` (material
  is captured, an allergy-safe flag isn't), and hosiery's
  `pack_quantity_value` (every row is a single item, though socks are
  routinely sold in packs). Each is marked `"gap": true` with a note —
  these are catalog-enrichment asks for whoever owns this feed, surfaced
  by the framework rather than papered over.

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
