import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProductCache } from "./resolve-products/cache";
import type { SearchProvider, SearchResultItem } from "./resolve-products/search-provider";
import { TavilySearchProvider } from "./resolve-products/tavily-provider";
import { resolveProducts } from "./resolve_products";

/** Test double standing in for a real HTTP search provider (Tavily). */
class FakeSearchProvider implements SearchProvider {
  public calls: string[] = [];
  constructor(private readonly resultsByQuery: SearchResultItem[] | ((query: string) => SearchResultItem[])) {}

  async search(query: string): Promise<SearchResultItem[]> {
    this.calls.push(query);
    return typeof this.resultsByQuery === "function" ? this.resultsByQuery(query) : this.resultsByQuery;
  }
}

const MULTI_RETAILER_RESULTS: SearchResultItem[] = [
  {
    title: "Kingsford Charcoal Briquettes 5kg",
    url: "https://www.walmart.com/ip/kingsford-5kg",
    content: "Kingsford Charcoal Briquettes 5kg - $12.99, ships free",
    score: 0.92,
  },
  {
    title: "Charcoal Briquettes 5kg Bag",
    url: "https://www.amazon.com/dp/B000CHAR5K",
    content: "Charcoal Briquettes 5kg Bag for $14.49 - Prime eligible",
    score: 0.88,
  },
  {
    title: "BBQ Charcoal Briquettes 5kg",
    url: "https://www.homedepot.com/p/charcoal-5kg",
    content: "BBQ Charcoal Briquettes 5kg, $13.25 in store and online",
    score: 0.75,
  },
];

describe("resolveProducts", () => {
  let cache: InMemoryProductCache;

  beforeEach(() => {
    cache = new InMemoryProductCache();
  });

  it("returns >=2 candidates from different retailers for 'charcoal briquettes 5kg'", async () => {
    const searchProvider = new FakeSearchProvider(MULTI_RETAILER_RESULTS);

    const output = await resolveProducts(
      { item_name: "charcoal briquettes 5kg" },
      { cache, searchProvider },
    );

    expect(output.reason).toBeNull();
    expect(output.results.length).toBeGreaterThanOrEqual(2);
    expect(output.results.length).toBeLessThanOrEqual(3);

    const retailers = new Set(output.results.map((r) => r.retailer));
    expect(retailers.size).toBe(output.results.length); // every candidate from a distinct retailer

    for (const r of output.results) {
      expect(typeof r.price).toBe("number");
      expect(r.price).toBeGreaterThan(0);
      expect(r.currency).toBe("USD");
      // Every url must trace back to one of the actually-fetched results.
      expect(MULTI_RETAILER_RESULTS.map((res) => res.url)).toContain(r.url);
    }
  });

  it("drops a result with no extractable price and still returns the other valid, distinct-retailer candidates", async () => {
    const resultsWithOnePriceless: SearchResultItem[] = [
      ...MULTI_RETAILER_RESULTS,
      {
        title: "Charcoal Briquettes 5kg - Ace Hardware",
        url: "https://www.acehardware.com/p/charcoal-5kg",
        content: "Charcoal Briquettes 5kg - check price in store, call for availability",
        score: 0.95,
      },
    ];
    const searchProvider = new FakeSearchProvider(resultsWithOnePriceless);

    const output = await resolveProducts(
      { item_name: "charcoal briquettes 5kg" },
      { cache, searchProvider },
    );

    expect(output.results.some((r) => r.retailer === "Ace Hardware")).toBe(false);
    expect(output.results.every((r) => typeof r.price === "number")).toBe(true);
  });

  it("returns [] with reason 'no_match' for a nonsense item with no search results", async () => {
    const searchProvider = new FakeSearchProvider([]);

    const output = await resolveProducts(
      { item_name: "zqxflarbnitz gronk 9000" },
      { cache, searchProvider },
    );

    expect(output).toEqual({ results: [], reason: "no_match" });
  });

  it("returns [] with reason 'no_price_extractable' when no result has a usable price", async () => {
    const searchProvider = new FakeSearchProvider([
      {
        title: "Some Product",
        url: "https://www.walmart.com/ip/1",
        content: "Call store for pricing, availability varies",
      },
      {
        title: "Some Product Alt",
        url: "https://www.amazon.com/dp/2",
        content: "Currently unavailable, 50% more stores restocking soon",
      },
    ]);

    const output = await resolveProducts({ item_name: "mystery item" }, { cache, searchProvider });

    expect(output).toEqual({ results: [], reason: "no_price_extractable" });
  });

  it("returns [] with reason 'insufficient_retailer_diversity' when only one distinct retailer has a priced result", async () => {
    const searchProvider = new FakeSearchProvider([
      {
        title: "Product A",
        url: "https://www.amazon.com/dp/1",
        content: "$9.99 buy now",
      },
      {
        title: "Product A - another listing",
        url: "https://www.amazon.com/dp/2",
        content: "$10.49 buy now",
      },
    ]);

    const output = await resolveProducts({ item_name: "single retailer item" }, { cache, searchProvider });

    expect(output).toEqual({ results: [], reason: "insufficient_retailer_diversity" });
  });

  it("never returns exactly one result when 2+ valid distinct-retailer candidates exist", async () => {
    const searchProvider = new FakeSearchProvider(MULTI_RETAILER_RESULTS);

    const output = await resolveProducts({ item_name: "charcoal briquettes 5kg" }, { cache, searchProvider });

    expect(output.results.length).not.toBe(1);
  });

  it("caches by normalized item_name for 24h and skips the search call entirely on a cache hit", async () => {
    const searchProvider = new FakeSearchProvider(MULTI_RETAILER_RESULTS);

    const first = await resolveProducts(
      { item_name: "  Charcoal   Briquettes 5kg  " },
      { cache, searchProvider },
    );
    expect(searchProvider.calls.length).toBe(1);

    const second = await resolveProducts(
      { item_name: "charcoal briquettes 5kg" }, // different casing/whitespace, same normalized key
      { cache, searchProvider },
    );

    expect(searchProvider.calls.length).toBe(1); // no second HTTP call
    expect(second).toEqual(first);
  });

  it("caches negative (no_match) results too, so a repeat nonsense query also skips the search call", async () => {
    const searchProvider = new FakeSearchProvider([]);

    await resolveProducts({ item_name: "nonsense xyz" }, { cache, searchProvider });
    await resolveProducts({ item_name: "nonsense xyz" }, { cache, searchProvider });

    expect(searchProvider.calls.length).toBe(1);
  });

  it("treats a different item_name as a different cache key", async () => {
    const searchProvider = new FakeSearchProvider(MULTI_RETAILER_RESULTS);

    await resolveProducts({ item_name: "charcoal briquettes 5kg" }, { cache, searchProvider });
    await resolveProducts({ item_name: "propane tank" }, { cache, searchProvider });

    expect(searchProvider.calls.length).toBe(2);
  });

  it("propagates a clear error instead of fabricating data when the search provider has no API key configured", async () => {
    delete process.env.TAVILY_API_KEY;
    const liveProvider = new TavilySearchProvider(); // no override key, no fetchImpl override

    await expect(
      resolveProducts({ item_name: "never cached item xyz" }, { cache, searchProvider: liveProvider }),
    ).rejects.toThrow(/TAVILY_API_KEY/);
  });

  it("end-to-end through TavilySearchProvider with a mocked HTTP fetch call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        query: "charcoal briquettes 5kg price buy online",
        results: MULTI_RETAILER_RESULTS,
      }),
      text: async () => "",
    } as Response);

    const provider = new TavilySearchProvider({ apiKey: "tvly-test-key", fetchImpl });

    const output = await resolveProducts(
      { item_name: "charcoal briquettes 5kg" },
      { cache, searchProvider: provider },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(output.reason).toBeNull();
    expect(output.results.length).toBeGreaterThanOrEqual(2);
  });
});
