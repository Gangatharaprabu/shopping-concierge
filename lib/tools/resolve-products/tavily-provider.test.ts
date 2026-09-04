import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingSearchApiKeyError } from "./search-provider";
import { TavilySearchProvider } from "./tavily-provider";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? 200;
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("TavilySearchProvider", () => {
  const originalEnv = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    process.env.TAVILY_API_KEY = originalEnv;
  });

  it("throws MissingSearchApiKeyError when no key is configured, without making an HTTP call", async () => {
    delete process.env.TAVILY_API_KEY;
    const fetchImpl = vi.fn();
    const provider = new TavilySearchProvider({ fetchImpl });

    await expect(provider.search("charcoal briquettes 5kg")).rejects.toBeInstanceOf(
      MissingSearchApiKeyError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a Bearer-authenticated POST with the query and parses results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "charcoal briquettes 5kg price buy online",
        results: [
          {
            title: "Kingsford Charcoal Briquettes 5kg",
            url: "https://www.walmart.com/ip/12345",
            content: "Kingsford Charcoal Briquettes 5kg - $12.99",
            score: 0.91,
          },
        ],
      }),
    );

    const provider = new TavilySearchProvider({ apiKey: "tvly-test-key", fetchImpl });
    const results = await provider.search("charcoal briquettes 5kg price buy online");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers.Authorization).toBe("Bearer tvly-test-key");
    const sentBody = JSON.parse(requestInit.body);
    expect(sentBody.query).toBe("charcoal briquettes 5kg price buy online");

    expect(results).toEqual([
      {
        title: "Kingsford Charcoal Briquettes 5kg",
        url: "https://www.walmart.com/ip/12345",
        content: "Kingsford Charcoal Briquettes 5kg - $12.99",
        score: 0.91,
      },
    ]);
  });

  it("throws a descriptive error on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, { ok: false, status: 400 }));
    const provider = new TavilySearchProvider({ apiKey: "tvly-test-key", fetchImpl });

    await expect(provider.search("anything")).rejects.toThrow(/400/);
  });

  it("returns an empty array when the provider returns no results field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ query: "x" }));
    const provider = new TavilySearchProvider({ apiKey: "tvly-test-key", fetchImpl });

    expect(await provider.search("asdkfjaslkdfjalskdjf nonsense item xyz")).toEqual([]);
  });
});
