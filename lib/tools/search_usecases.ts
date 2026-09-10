/**
 * search_usecases tool
 *
 * Ranked search/feed retrieval over the UseCase catalogue (CLAUDE.md: "get
 * matched to one of 1000+ pre-built use cases"). This is the feed-agent
 * layer: given free-text `query` (and optional personalization/context),
 * return the catalogue ranked by a cheap, deterministic scoring function --
 * no LLM call per request (see the brief this file implements).
 *
 * Contract: /docs/tool-specs/search_usecases.md (read that first -- this
 * file implements it, doesn't redefine it).
 *
 * ---------------------------------------------------------------------------
 * Design: why UseCase[] is a parameter, not fetched internally
 * ---------------------------------------------------------------------------
 * `searchUseCases` is pure: it takes the candidate catalogue as an argument
 * rather than querying Supabase itself. That's deliberate (see the task
 * non-goals): the ranking logic needs zero DB wiring to be correct or
 * tested, and it lets /app/api/usecases/search/route.ts stay a thin
 * fetch-then-rank wrapper (fetch rows -> call this -> return JSON) without
 * duplicating scoring logic. At ~1000 use cases, scoring the full candidate
 * set in-process per request is cheap (no ANN index needed at this scale).
 *
 * ---------------------------------------------------------------------------
 * Scoring model -- four signals, combined as a documented weighted sum
 * ---------------------------------------------------------------------------
 * total_score = keywordScore
 *             + SIMILARITY_WEIGHT * similarityScore(query, useCase)
 *             + personalizationScore
 *             + seasonalScore
 *
 * 1. keywordScore -- deterministic lexical relevance against the free-text
 *    query, matched against title / description / tags / category+subcategory.
 *    No stemming/fuzzy matching, no external index -- token-set overlap,
 *    substring/prefix phrase match, and exact tag match. See WEIGHTS below
 *    for the exact per-component weight and rationale.
 *
 * 2. similarityScore -- an explicit, documented seam for a future
 *    pgvector/embedding step (CLAUDE.md names pgvector as the intended
 *    mechanism; `use_cases.embedding` already exists as a column but nothing
 *    populates or queries it yet -- see /docs/tool-specs/search_usecases.md
 *    "Open decision" section for why this isn't wired up in this phase).
 *    Defaults to `noopSimilarityScore`, which always returns 0 (neutral --
 *    contributes nothing to ranking). To upgrade later: implement a real
 *    `SimilarityScoreFn` backed by a pgvector cosine-similarity lookup (or
 *    a precomputed query->useCase score map) and pass it via
 *    `deps.similarityScore` -- no other change to this file or its callers
 *    is required. This mirrors the established pattern in this repo of
 *    "interim heuristic now, documented swap point later" (see
 *    lib/tools/resolve-products/cache.ts's ProductCache interface and
 *    scripts/usecase-pipeline/lib/dedup.ts's lexical-dedup-until-embeddings
 *    note).
 *
 * 3. personalizationScore -- optional boost when a UserMemory-shaped object
 *    is supplied (household_size, dietary_prefs, budget_tier, brand_prefs).
 *    Purely additive on top of keyword relevance; the function works
 *    identically with no memory supplied (all personalization terms are 0).
 *    Per CLAUDE.md's memory boundary, this only ever *reads* memory to bias
 *    ranking -- it never writes to it and never treats scenario-only facts
 *    as memory.
 *
 * 4. seasonalScore -- deterministic month-based boost for `seasonal.*`
 *    subcategories during their relevant time of year (SEASONAL_MONTHS
 *    below), driven by `opts.now` (defaults to `new Date()`, injectable for
 *    tests). Not tied to any external calendar/weather data.
 *
 * Weights live in one place (WEIGHTS) specifically so the relative
 * contribution of each signal is visible and easy to retune without
 * hunting through the scoring functions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal slot-definition shape this module reads (subset of
 * /docs/schemas/use-case.schema.json's `slot_definition`). Intentionally a
 * local, narrower mirror rather than importing scripts/usecase-pipeline's
 * authoring types -- same "hand-kept, independently-scoped mirror" approach
 * lib/types.ts documents for itself, since this module only ever reads a
 * few fields (type/options/default/min/max), not the full authoring shape.
 */
export interface SlotDefinitionForSearch {
  type: "enum" | "integer" | "tag_list" | "duration" | string;
  options?: string[];
  default?: unknown;
  min?: number;
  max?: number;
}

/**
 * Minimal UseCase shape this module needs to rank (mirrors
 * /docs/schemas/use-case.schema.json's UseCase -- id/title/description/
 * category/subcategory/tags/scenario_slots -- omitting template_list, which
 * ranking never touches).
 */
export interface UseCaseForSearch {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  subcategory: string;
  tags: string[];
  scenario_slots: Record<string, SlotDefinitionForSearch>;
}

export type BudgetTier = "low" | "mid" | "high";

/**
 * Personalization input. Mirrors the durable fields of UserMemory from
 * CLAUDE.md / lib/types.ts's UserMemoryRow (household_size, dietary_prefs,
 * budget_tier, brand_prefs) but declared locally and fully optional so this
 * module doesn't need to import memory-agent's in-progress work to compile,
 * and so a caller can pass a partial memory (e.g. just budget_tier) freely.
 */
export interface SearchUseCasesMemory {
  household_size?: number | null;
  dietary_prefs?: string[] | null;
  budget_tier?: BudgetTier | null;
  brand_prefs?: string[] | null;
}

/**
 * The pgvector upgrade seam (see file header). Given the raw query and a
 * candidate UseCase, return a similarity score. Contract: expected range is
 * roughly [0, 1] (like a cosine similarity), so it composes predictably with
 * SIMILARITY_WEIGHT -- an implementation returning wildly different ranges
 * will just need SIMILARITY_WEIGHT retuned, not a change to this module's
 * combination logic.
 */
export type SimilarityScoreFn = (query: string, useCase: UseCaseForSearch) => number;

/** Default similarity hook: no embeddings provider wired up yet (see file header) -- always neutral. */
export const noopSimilarityScore: SimilarityScoreFn = () => 0;

export interface SearchUseCasesOptions {
  /** Hard filter, applied before scoring (same semantics as GET /api/usecases). */
  category?: string;
  /** Hard filter, applied before scoring. */
  subcategory?: string;
  /** Max results returned, applied after sorting. Defaults to the full filtered/scored set. */
  limit?: number;
  /** Optional personalization signal -- see SearchUseCasesMemory. Omit/null for no personalization boost. */
  memory?: SearchUseCasesMemory | null;
  /** Clock used for the seasonal signal. Defaults to `new Date()`; override in tests for determinism. */
  now?: Date;
}

export interface SearchUseCasesDeps {
  /** See SimilarityScoreFn / noopSimilarityScore above. */
  similarityScore?: SimilarityScoreFn;
}

/** Per-signal breakdown, exposed so ranking is explainable rather than an opaque single number. */
export interface ScoreSignals {
  keyword: number;
  similarity: number;
  personalization: number;
  seasonal: number;
}

export interface ScoredUseCase {
  useCase: UseCaseForSearch;
  score: number;
  signals: ScoreSignals;
}

// ---------------------------------------------------------------------------
// Weights -- the one place that decides how much each signal matters.
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  /** Whole normalized query appears verbatim as a substring of the title (strongest, most specific lexical signal). */
  titlePhraseMatch: 3,
  /** Fraction of query tokens present in the title's token set. */
  titleTokenOverlap: 2,
  /** Per exactly-matched tag (query token === a tag's token), capped at TAG_MATCH_CAP. */
  tagExactMatch: 1.5,
  /** Fraction of query tokens present in the description's token set. */
  descriptionTokenOverlap: 1,
  /** Fraction of query tokens present in category+subcategory id tokens (e.g. "bbq" matches events.bbq_grilling). */
  categorySubcategoryTokenOverlap: 1,
  /** Multiplier applied to the (expected ~[0,1]) similarityScore hook output -- see SimilarityScoreFn. */
  similarity: 2,
  /** Per matching dietary_prefs entry against a use case's `dietary` slot options, capped at DIETARY_MATCH_CAP. */
  dietaryMatch: 1,
  /** Flat boost when a use case's `budget_tier` slot default equals the user's durable budget_tier. */
  budgetTierMatch: 0.5,
  /** Flat boost when a use case's `headcount` slot range [min, max] contains the user's household_size. */
  headcountFit: 0.5,
  /** Flat boost for a `seasonal.*` use case whose subcategory is in-season this month (see SEASONAL_MONTHS). */
  seasonal: 1.5,
} as const;

const TAG_MATCH_CAP = 3;
const DIETARY_MATCH_CAP = 2;

// ---------------------------------------------------------------------------
// Tokenization -- shared by every lexical component of keywordScore.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "and", "or", "with", "to", "on", "in", "at",
  "my", "our", "your", "is", "are", "this", "that",
]);

/** Lowercase, strip punctuation to spaces, collapse whitespace, trim. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** normalize() + split + drop stopwords/empties. Used for token-set overlap comparisons. */
function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((tok) => tok.length > 0 && !STOPWORDS.has(tok));
}

/** Fraction of `queryTokens` present in `targetTokens`'s set. 0 if queryTokens is empty. */
function tokenOverlapRatio(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const targetSet = new Set(targetTokens);
  let matches = 0;
  for (const tok of queryTokens) {
    if (targetSet.has(tok)) matches++;
  }
  return matches / queryTokens.length;
}

// ---------------------------------------------------------------------------
// Signal 1: keyword relevance
// ---------------------------------------------------------------------------

function computeKeywordScore(query: string, useCase: UseCaseForSearch): number {
  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(query);
  if (normalizedQuery.length === 0 || queryTokens.length === 0) {
    // No query text -- e.g. a plain "browse the feed" call. Keyword signal
    // is neutral for every candidate; personalization/seasonal still apply.
    return 0;
  }

  const normalizedTitle = normalize(useCase.title);
  const titlePhraseMatch = normalizedTitle.includes(normalizedQuery) ? 1 : 0;
  const titleOverlap = tokenOverlapRatio(queryTokens, tokenize(useCase.title));

  const descOverlap = useCase.description ? tokenOverlapRatio(queryTokens, tokenize(useCase.description)) : 0;

  const tagTokenSet = new Set(useCase.tags.flatMap((tag) => tokenize(tag)));
  let tagMatches = 0;
  for (const tok of queryTokens) {
    if (tagTokenSet.has(tok)) tagMatches++;
  }
  const tagScore = Math.min(tagMatches, TAG_MATCH_CAP);

  const categorySubcategoryTokens = tokenize(`${useCase.category} ${useCase.subcategory.replace(".", " ")}`);
  const categoryOverlap = tokenOverlapRatio(queryTokens, categorySubcategoryTokens);

  return (
    WEIGHTS.titlePhraseMatch * titlePhraseMatch +
    WEIGHTS.titleTokenOverlap * titleOverlap +
    WEIGHTS.tagExactMatch * tagScore +
    WEIGHTS.descriptionTokenOverlap * descOverlap +
    WEIGHTS.categorySubcategoryTokenOverlap * categoryOverlap
  );
}

// ---------------------------------------------------------------------------
// Signal 3: personalization (optional -- 0 contribution with no memory)
// ---------------------------------------------------------------------------

function computePersonalizationScore(memory: SearchUseCasesMemory | null | undefined, useCase: UseCaseForSearch): number {
  if (!memory) return 0;
  let score = 0;

  const dietarySlot = useCase.scenario_slots?.dietary;
  if (dietarySlot?.type === "tag_list" && dietarySlot.options && memory.dietary_prefs?.length) {
    const optionSet = new Set(dietarySlot.options.map((o) => o.toLowerCase()));
    const matches = memory.dietary_prefs.filter((pref) => optionSet.has(pref.toLowerCase())).length;
    score += WEIGHTS.dietaryMatch * Math.min(matches, DIETARY_MATCH_CAP);
  }

  const budgetSlot = useCase.scenario_slots?.budget_tier;
  if (budgetSlot?.type === "enum" && memory.budget_tier && budgetSlot.default === memory.budget_tier) {
    score += WEIGHTS.budgetTierMatch;
  }

  const headcountSlot = useCase.scenario_slots?.headcount;
  if (
    headcountSlot?.type === "integer" &&
    typeof memory.household_size === "number" &&
    typeof headcountSlot.min === "number" &&
    typeof headcountSlot.max === "number" &&
    memory.household_size >= headcountSlot.min &&
    memory.household_size <= headcountSlot.max
  ) {
    score += WEIGHTS.headcountFit;
  }

  // brand_prefs: UseCase has no product/brand data in this schema (products
  // are resolved live via resolve_products, not stored on the use case) --
  // there is nothing to match brand_prefs against here. Deliberately a
  // documented no-op, not a silently-dropped field.

  return score;
}

// ---------------------------------------------------------------------------
// Signal 4: seasonal/recency boost
// ---------------------------------------------------------------------------

/**
 * Month-based "in season" lookup per seasonal.* subcategory (1 = January ...
 * 12 = December). Deliberately simple and hand-authored -- no external
 * calendar/holiday-date data, just "roughly which months this subcategory is
 * relevant in the northern-hemisphere-default sense a US-centric prototype
 * assumes elsewhere in this app (e.g. Thanksgiving/Christmas seed content)."
 *
 * seasonal.severe_weather_prep is intentionally broad (spans hurricane
 * season *and* winter storm season, since seed content covers both
 * "hurricane-season-prep-kit" and "winter-storm-emergency-kit" under the
 * same subcategory) -- a real per-use-case season would need a season field
 * on UseCase itself, which is out of scope for this phase.
 */
export const SEASONAL_MONTHS: Readonly<Record<string, readonly number[]>> = {
  "seasonal.back_to_school": [8, 9],
  "seasonal.holiday_hosting": [11, 12],
  "seasonal.summer_prep": [5, 6],
  "seasonal.winter_prep": [10, 11],
  "seasonal.spring_cleaning": [3, 4],
  "seasonal.fall_prep": [9, 10],
  "seasonal.halloween": [10],
  "seasonal.new_year_eve": [12],
  "seasonal.spring_break": [2, 3],
  "seasonal.gift_wrapping_decor": [11, 12],
  "seasonal.allergy_season": [3, 4, 5],
  "seasonal.severe_weather_prep": [1, 2, 6, 7, 8, 9, 10, 11, 12],
  "seasonal.gardening_planting": [3, 4, 5, 9],
};

function computeSeasonalScore(now: Date, useCase: UseCaseForSearch): number {
  const months = SEASONAL_MONTHS[useCase.subcategory];
  if (!months) return 0;
  const currentMonth = now.getMonth() + 1; // Date.getMonth() is 0-indexed
  return months.includes(currentMonth) ? WEIGHTS.seasonal : 0;
}

// ---------------------------------------------------------------------------
// Combine + rank
// ---------------------------------------------------------------------------

function scoreUseCase(
  query: string,
  useCase: UseCaseForSearch,
  opts: SearchUseCasesOptions,
  deps: SearchUseCasesDeps,
): ScoredUseCase {
  const now = opts.now ?? new Date();
  const similarityFn = deps.similarityScore ?? noopSimilarityScore;

  const keyword = computeKeywordScore(query, useCase);
  const similarity = WEIGHTS.similarity * similarityFn(query, useCase);
  const personalization = computePersonalizationScore(opts.memory, useCase);
  const seasonal = computeSeasonalScore(now, useCase);

  return {
    useCase,
    score: keyword + similarity + personalization + seasonal,
    signals: { keyword, similarity, personalization, seasonal },
  };
}

/**
 * Rank `useCases` for `query`, combining keyword relevance, an (optional,
 * currently neutral) embedding-similarity hook, personalization, and
 * seasonal signals into one transparent weighted score. See file header for
 * the full design writeup.
 *
 * Deterministic: given the same inputs (including `opts.now`), always
 * produces the same order -- ties break on `useCase.id` ascending, never on
 * insertion order or Math.random.
 *
 * `useCases` is the candidate set to rank (e.g. the full catalogue, or a
 * pre-filtered slice) -- this function never fetches data itself, see file
 * header "why UseCase[] is a parameter".
 */
export function searchUseCases(
  useCases: UseCaseForSearch[],
  query: string,
  opts: SearchUseCasesOptions = {},
  deps: SearchUseCasesDeps = {},
): ScoredUseCase[] {
  const filtered = useCases.filter((uc) => {
    if (opts.category && uc.category !== opts.category) return false;
    if (opts.subcategory && uc.subcategory !== opts.subcategory) return false;
    return true;
  });

  const scored = filtered.map((uc) => scoreUseCase(query, uc, opts, deps));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.useCase.id.localeCompare(b.useCase.id);
  });

  const limit = opts.limit ?? scored.length;
  return scored.slice(0, Math.max(0, limit));
}
