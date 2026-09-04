/**
 * Provider-agnostic shape for a single web search result. Whichever HTTP
 * search API we call (Tavily today) must be adapted down to this shape so
 * the rest of resolve_products never depends on a specific provider's
 * response format. Swapping providers later = write a new adapter that
 * implements SearchProvider, nothing else changes.
 */
export interface SearchResultItem {
  title: string;
  url: string;
  /** Snippet / extracted page text the provider gives us — used for price extraction. */
  content: string;
  /** Provider-reported relevance score, 0-1, if it gives us one. */
  score?: number;
}

export interface SearchProvider {
  search(query: string, opts?: { maxResults?: number }): Promise<SearchResultItem[]>;
}

/** Thrown when the configured search provider has no API key available at call time. */
export class MissingSearchApiKeyError extends Error {
  constructor(envVarName: string) {
    super(
      `resolve_products: no search API key found in process.env.${envVarName}. ` +
        `Set ${envVarName} to a valid key before calling resolve_products with a cache miss. ` +
        `Refusing to fabricate product data.`,
    );
    this.name = "MissingSearchApiKeyError";
  }
}
