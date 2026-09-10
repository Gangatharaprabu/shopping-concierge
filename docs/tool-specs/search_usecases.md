# search_usecases tool — spec

## Purpose
Rank the UseCase catalogue (1000+ pre-built use cases at target scale, 49
seeded today) for a free-text query, optionally biased by a user's durable
memory and by time-of-year, so `feed-agent`/the frontend can show a relevant
feed or search-results list without calling an LLM per request.

## Contract

`searchUseCases(useCases, query, opts?, deps?) -> ScoredUseCase[]`

Input:
```
useCases: UseCaseForSearch[]   // candidate set to rank (e.g. the full catalogue)
query: string                  // free text, e.g. "hosting a BBQ"; "" = no keyword signal (browse mode)
opts?: {
  category?: string            // hard filter, applied before scoring
  subcategory?: string         // hard filter, applied before scoring
  limit?: number                // max results returned; default = full filtered/scored set
  memory?: {                    // optional personalization input -- UserMemory subset, see below
    household_size?: number | null
    dietary_prefs?: string[] | null
    budget_tier?: "low" | "mid" | "high" | null
    brand_prefs?: string[] | null
  } | null
  now?: Date                    // clock for the seasonal signal; default new Date()
}
deps?: {
  similarityScore?: (query: string, useCase: UseCaseForSearch) => number
  // pgvector/embedding upgrade seam -- see "Open decisions" below.
  // Defaults to noopSimilarityScore (always 0, i.e. no effect on ranking).
}
```

Output: `ScoredUseCase[]`, each `{ useCase, score, signals }` where `signals`
is `{ keyword, similarity, personalization, seasonal }` -- the per-component
contributions to `score`, exposed so ranking is explainable rather than an
opaque number (a caller/reviewer can see *why* one use case outranked
another). Sorted by `score` descending; ties break on `useCase.id` ascending
for full determinism.

`UseCaseForSearch` is the subset of `/docs/schemas/use-case.schema.json`'s
`UseCase` this module reads: `id, title, description?, category,
subcategory, tags, scenario_slots` (never `template_list` -- ranking doesn't
need it).

## Scoring model

```
total_score = keywordScore
            + WEIGHTS.similarity * similarityScore(query, useCase)   // default 0
            + personalizationScore
            + seasonalScore
```

All four signals are computed independently and summed -- a documented
weighted sum, not a black box. Exact weights live in one place,
`WEIGHTS` in `lib/tools/search_usecases.ts`, specifically so they're easy to
find and retune without hunting through the scoring functions.

1. **keywordScore** -- deterministic lexical relevance, no external index:
   - Whole normalized query as a substring of the title (`titlePhraseMatch`,
     weight 3) -- the strongest, most specific signal ("bbq cookout" against
     "Backyard BBQ Cookout").
   - Fraction of query tokens present in the title's token set
     (`titleTokenOverlap`, weight 2).
   - Exact tag match: each query token that exactly matches a tag's token
     (`tagExactMatch`, weight 1.5 per match, capped at 3 matches).
   - Fraction of query tokens present in the description's token set
     (`descriptionTokenOverlap`, weight 1).
   - Fraction of query tokens present in `category`+`subcategory` id tokens,
     e.g. "bbq" matches `events.bbq_grilling` (`categorySubcategoryTokenOverlap`,
     weight 1).
   - Tokenization: lowercase, strip punctuation, collapse whitespace, drop a
     small stopword list (`a/an/the/for/of/...`). No stemming/fuzzy matching.
   - Empty/whitespace-only query -> keywordScore is 0 for every candidate
     ("browse the feed" mode) -- personalization/seasonal still apply.

2. **similarityScore hook** -- see "Open decisions" below. Multiplied by
   `WEIGHTS.similarity` (2). Expected range ~[0, 1] like a cosine similarity.

3. **personalizationScore** -- optional, 0 if `opts.memory` is omitted:
   - `dietary_prefs`: +1 per pref that appears in the use case's `dietary`
     slot options (capped at 2 matches) -- e.g. a user with
     `dietary_prefs: ["vegan"]` ranks a BBQ use case whose `dietary` slot
     options include `"vegan"` higher.
   - `budget_tier`: +0.5 flat if the use case's `budget_tier` slot `default`
     equals the user's durable `budget_tier`.
   - `household_size`: +0.5 flat if the use case's `headcount` slot range
     `[min, max]` contains the user's `household_size`.
   - `brand_prefs`: no signal -- `UseCase` carries no product/brand data
     (products are resolved live via `resolve_products`, never stored on the
     use case), so there's nothing to match against. Documented no-op, not a
     silently dropped field.
   - This only ever *reads* `memory` to bias ranking; it never writes to
     memory and never treats scenario-only facts (this event's headcount,
     this event's dietary override) as memory -- per CLAUDE.md's memory
     boundary, that distinction belongs to the caller supplying `opts.memory`
     from the right source, not to this function.

4. **seasonalScore** -- deterministic, `opts.now`-driven: +1.5 flat if the
   use case's subcategory is a `seasonal.*` id and the current month is in
   that subcategory's `SEASONAL_MONTHS` entry (e.g.
   `seasonal.halloween` -> October). The month table is hand-authored, not
   backed by any external calendar/weather API -- see `SEASONAL_MONTHS` in
   `lib/tools/search_usecases.ts` for the full table and rationale
   (`seasonal.severe_weather_prep` is intentionally broad, covering both
   hurricane season and winter storm season, since seed content puts both
   under one subcategory).

## Open decisions (flagged, not solved here)

- **No embeddings provider is wired up.** CLAUDE.md names `pgvector` as the
  intended mechanism for use-case/feed embedding search, and
  `use_cases.embedding vector(1536)` already exists as a column
  (`/db/migrations/0002_use_cases.sql`), but nothing populates or queries it
  yet, and no embeddings API key/provider is configured in this environment.
  Rather than build against an unverified integration (the way
  `product-sourcing-agent` flagged its Tavily response-shape assumption
  instead of silently guessing), this phase ships keyword + personalization
  + seasonal scoring only, with `deps.similarityScore` as the explicit,
  tested seam: implement a real `SimilarityScoreFn` (e.g. embed the query at
  request time, cosine-compare against `use_cases.embedding` via a pgvector
  query, or precompute a lookup) and pass it in -- no change needed to
  `searchUseCases`'s combination logic, filtering, sorting, or this route.
  Choosing the actual embedding provider (OpenAI, Voyage, Cohere, etc.) and
  writing the population script for `use_cases.embedding` is out of scope
  here and needs an explicit decision from the project owner.

## Constraints
- Pure function, no network/DB/LLM calls inside `searchUseCases` itself --
  the API route does the fetching, this function only ranks what it's given.
- Deterministic: identical `(useCases, query, opts, deps)` always produce
  identical output order (see id tie-break above) -- no reliance on
  `Array.prototype.sort`'s stability for the primary ordering guarantee.
- `opts.memory` is fully optional; every code path that reads it null-checks
  first, so omitting it (or passing `null`) never throws and never changes
  keyword/seasonal scoring.
- Never calls an LLM to rank results (per the task brief) -- scoring is a
  fixed arithmetic formula over precomputed token sets and lookup tables.

## Acceptance criteria
- Query `"BBQ"` ranks `backyard-bbq-cookout` / `fourth-of-july-grill-party`
  above unrelated use cases (e.g. a travel or home-setup use case).
- Query `""` (browse mode) still returns every candidate (subject to
  `category`/`subcategory` filters and `limit`), ordered by
  personalization/seasonal signals and then id.
- With `opts.now` set to an October date, `trick-or-treat-hosting`
  (`seasonal.halloween`) scores strictly higher than it does with `opts.now`
  set to a June date, all else equal.
- With `opts.memory.dietary_prefs: ["vegan"]`, a use case whose `dietary`
  slot options include `"vegan"` scores strictly higher than the same call
  with no `memory` supplied.
- Calling `searchUseCases` twice with identical arguments returns
  deep-equal results (order and scores).
