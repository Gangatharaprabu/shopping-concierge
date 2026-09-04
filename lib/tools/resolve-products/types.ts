/**
 * Shared types for the resolve_products tool.
 * Contract source of truth: /docs/tool-specs/resolve_products.md
 */

export type BudgetTier = "low" | "mid" | "high";

export interface ResolveProductsInput {
  item_name: string;
  quantity?: string;
  user_budget_tier?: BudgetTier;
}

export interface ProductCandidate {
  product_name: string;
  price: number;
  currency: string;
  retailer: string;
  url: string;
  /** 0-1 confidence that this candidate is a good match for the requested item. */
  matched_confidence: number;
}

/**
 * The spec's "Output" line (`[{ product_name, price, currency, retailer, url,
 * matched_confidence }]`) only describes the happy-path array shape. It doesn't
 * say how a caller is supposed to receive the empty-result *reason* the
 * acceptance criteria requires ("returns [] with reason 'no_match'"). We
 * resolve that ambiguity by wrapping the array in a small envelope:
 *   - `results` is exactly the array the spec describes (empty when nothing
 *     qualifies).
 *   - `reason` is null on success and a short machine-readable code when
 *     `results` is empty, explaining *why* (no search matches at all, no
 *     extractable price on any candidate, or not enough distinct retailers
 *     to satisfy the "never auto-pick one" rule).
 */
export type ResolveProductsReason =
  | "no_match"
  | "no_price_extractable"
  | "insufficient_retailer_diversity";

export interface ResolveProductsOutput {
  results: ProductCandidate[];
  reason: ResolveProductsReason | null;
}
