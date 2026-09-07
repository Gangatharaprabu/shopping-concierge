/**
 * resolve_products tool
 *
 * Turns one shopping-list item into 2-3 real, purchasable product options
 * via web search (no product catalogue exists in this app).
 *
 * Contract: /docs/tool-specs/resolve_products.md (read that first — this
 * file implements it, doesn't redefine it).
 *
 * Hard rules enforced here:
 *  - Every returned url comes from an actual fetched search result — this
 *    module never constructs or invents a URL/product.
 *  - A candidate without a confidently-extractable price is dropped, never
 *    guessed (see ./resolve-products/price-extraction.ts).
 *  - Cache key = normalized item_name only, 24h TTL — repeat requests for
 *    the same item within 24h never hit the search API.
 *  - Never returns exactly one candidate: either 2-3, or [] with a reason.
 */

import { InMemoryProductCache, normalizeItemName, type ProductCache } from "./resolve-products/cache";
import {
  extractPrice,
  retailerFromUrl,
  retailerKeyFromUrl,
} from "./resolve-products/price-extraction";
import type { SearchProvider, SearchResultItem } from "./resolve-products/search-provider";
import { TavilySearchProvider } from "./resolve-products/tavily-provider";
import type {
  BudgetTier,
  ProductCandidate,
  ResolveProductsInput,
  ResolveProductsOutput,
} from "./resolve-products/types";

export type {
  BudgetTier,
  ProductCandidate,
  ResolveProductsInput,
  ResolveProductsOutput,
  ResolveProductsReason,
} from "./resolve-products/types";
export type { ProductCache } from "./resolve-products/cache";
export type { SearchProvider, SearchResultItem } from "./resolve-products/search-provider";
export { MissingSearchApiKeyError } from "./resolve-products/search-provider";
export { normalizeItemName } from "./resolve-products/cache";

const MAX_CANDIDATES = 3;
const MIN_CANDIDATES = 2;

// Module-level defaults so repeated calls within the same process (the
// normal case for a running Next.js server) actually share the cache.
// Constructing TavilySearchProvider here is safe even with no API key set —
// it only reads process.env.TAVILY_API_KEY lazily, inside search(), so a
// process that only ever gets cache hits never needs the key.
const defaultCache = new InMemoryProductCache();
const defaultSearchProvider = new TavilySearchProvider();

export interface ResolveProductsDeps {
  cache?: ProductCache;
  searchProvider?: SearchProvider;
}

function buildSearchQuery(input: ResolveProductsInput): string {
  const parts = [input.item_name];
  if (input.quantity) parts.push(input.quantity);
  parts.push("price buy online");
  return parts.join(" ");
}

interface Scored extends ProductCandidate {
  retailerKey: string;
}

/** Default confidence for candidates whose provider result has no score, ranked by result order. */
function fallbackConfidence(index: number): number {
  return Math.max(0.1, Math.min(0.9, 0.6 - index * 0.05));
}

function toCandidate(result: SearchResultItem, index: number): Scored | null {
  const extracted = extractPrice(`${result.title} ${result.content}`);
  if (!extracted) return null;

  const retailerKey = retailerKeyFromUrl(result.url);
  const retailer = retailerFromUrl(result.url);
  if (!retailerKey || !retailer) return null;

  const matched_confidence =
    typeof result.score === "number"
      ? Math.max(0, Math.min(1, result.score))
      : fallbackConfidence(index);

  return {
    product_name: result.title,
    price: extracted.price,
    currency: extracted.currency,
    retailer,
    url: result.url,
    matched_confidence,
    retailerKey,
  };
}

/** One candidate per distinct retailer, keeping the first (highest-ranked) hit for that retailer. */
function dedupeByRetailer(candidates: Scored[]): Scored[] {
  const seen = new Set<string>();
  const out: Scored[] = [];
  for (const c of candidates) {
    if (seen.has(c.retailerKey)) continue;
    seen.add(c.retailerKey);
    out.push(c);
  }
  return out;
}

/**
 * Primary sort is always relevance (matched_confidence) — the spec doesn't
 * say budget_tier should override relevance, only that it's part of the
 * input. We use it only as a light tie-breaker among near-equally-relevant
 * candidates (within 0.05 confidence of each other): "low" nudges cheaper
 * options earlier, "high" nudges pricier (assumed-premium) options earlier.
 * This is a reasonable-but-not-spec-mandated interpretation — flagged in
 * the task report as an ambiguity, not guessed at silently.
 */
function sortCandidates(candidates: Scored[], tier: BudgetTier | undefined): Scored[] {
  const TIE_THRESHOLD = 0.05;
  return [...candidates].sort((a, b) => {
    const confDiff = b.matched_confidence - a.matched_confidence;
    if (Math.abs(confDiff) > TIE_THRESHOLD || !tier || tier === "mid") {
      return confDiff;
    }
    return tier === "low" ? a.price - b.price : b.price - a.price;
  });
}

export async function resolveProducts(
  input: ResolveProductsInput,
  deps: ResolveProductsDeps = {},
): Promise<ResolveProductsOutput> {
  const cache = deps.cache ?? defaultCache;
  const searchProvider = deps.searchProvider ?? defaultSearchProvider;

  const cacheKey = normalizeItemName(input.item_name);
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rawResults = await searchProvider.search(buildSearchQuery(input), { maxResults: 8 });

  let output: ResolveProductsOutput;

  if (rawResults.length === 0) {
    output = { results: [], reason: "no_match" };
  } else {
    const priced = rawResults
      .map((r, i) => toCandidate(r, i))
      .filter((c): c is Scored => c !== null);

    if (priced.length === 0) {
      output = { results: [], reason: "no_price_extractable" };
    } else {
      const distinct = dedupeByRetailer(priced);

      if (distinct.length < MIN_CANDIDATES) {
        output = { results: [], reason: "insufficient_retailer_diversity" };
      } else {
        const sorted = sortCandidates(distinct, input.user_budget_tier);
        const top: ProductCandidate[] = sorted.slice(0, MAX_CANDIDATES).map((c) => ({
          product_name: c.product_name,
          price: c.price,
          currency: c.currency,
          retailer: c.retailer,
          url: c.url,
          matched_confidence: c.matched_confidence,
        }));
        output = { results: top, reason: null };
      }
    }
  }

  await cache.set(cacheKey, output);
  return output;
}
