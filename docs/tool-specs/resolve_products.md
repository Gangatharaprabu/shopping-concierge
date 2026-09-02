# resolve_products tool — spec

## Purpose
Turn one shopping-list item into 2-3 real, purchasable product options via
web search (no catalogue exists).

## Contract
Input:  { item_name: string, quantity?: string, user_budget_tier?: "low"|"mid"|"high" }
Output: [{ product_name, price, currency, retailer, url, matched_confidence }]

## Constraints
- Every returned url must come from an actual fetched search result, never invented.
- No result without an extractable price is returned; return [] + reason instead.
- Cache by normalized item_name for 24h.
- Never auto-pick a single result — always return 2-3 candidates across retailers.

## Acceptance criteria
- Given "charcoal briquettes 5kg", returns >=2 candidates from different retailers.
- Given a nonsense item, returns [] with reason "no_match", not a fabricated product.
- p95 latency under 3s on cache hit, under 8s on cache miss.
