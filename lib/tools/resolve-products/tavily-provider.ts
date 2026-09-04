import {
  MissingSearchApiKeyError,
  type SearchProvider,
  type SearchResultItem,
} from "./search-provider";

/**
 * Adapter for the Tavily Search API (https://tavily.com).
 *
 * Chosen because it's the example explicitly named in CLAUDE.md's "AI calls"
 * convention, it's a plain HTTP JSON API (no SDK dependency needed to keep
 * this prototype light), and it returns ready-to-use snippet text per result
 * which is what price extraction needs (as opposed to raw HTML we'd have to
 * scrape ourselves).
 *
 * NOTE ON VERIFICATION: this sandbox has no TAVILY_API_KEY and outbound
 * access to docs.tavily.com was blocked by the network egress proxy while
 * building this, so the request/response shape below is based on Tavily's
 * publicly documented API surface (POST /search, Bearer auth, a `results[]`
 * array of { title, url, content, score }) rather than a live call against
 * the real endpoint. Before relying on this in production, run one real
 * request with a valid key and diff the actual response against
 * `TavilySearchResponse` below — see the TODO on that type.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const API_KEY_ENV_VAR = "TAVILY_API_KEY";

// TODO(verify-against-live-api): shape reconstructed from Tavily's published
// docs, not confirmed against a live response (no key available in this
// sandbox, and docs.tavily.com was unreachable through the egress proxy at
// build time). Re-check this against a real response before first
// production use.
interface TavilySearchResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
  }>;
}

export interface TavilyProviderOptions {
  /** Overrides process.env.TAVILY_API_KEY — mainly for tests. */
  apiKey?: string;
  /** Overrides the endpoint — mainly for tests. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export class TavilySearchProvider implements SearchProvider {
  private readonly apiKeyOverride?: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TavilyProviderOptions = {}) {
    this.apiKeyOverride = options.apiKey;
    this.endpoint = options.endpoint ?? TAVILY_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, opts: { maxResults?: number } = {}): Promise<SearchResultItem[]> {
    // Resolved lazily, at call time, not in the constructor: a cache hit
    // should never require a key, and importing this module (e.g. to build
    // a singleton) shouldn't crash a process that hasn't made a live search
    // yet. Missing-key failures must be loud and specific, not a silent
    // empty/fabricated result.
    const apiKey = this.apiKeyOverride ?? process.env[API_KEY_ENV_VAR];
    if (!apiKey) {
      throw new MissingSearchApiKeyError(API_KEY_ENV_VAR);
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: opts.maxResults ?? 8,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `Tavily search request failed: ${response.status} ${response.statusText} ${bodyText}`.trim(),
      );
    }

    const data = (await response.json()) as TavilySearchResponse;
    if (!Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content ?? "",
      score: typeof r.score === "number" ? r.score : undefined,
    }));
  }
}
